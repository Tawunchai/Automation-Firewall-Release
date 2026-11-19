package topologydevice

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// Topology ▸ Add Device — the user's own pinned devices on the 3D map.
//
// Everything here is scoped to the signed-in user (OwnerUserID). The map is personal: two operators
// on the same firewall keep their own sets, which is why list/create/edit/delete all key on the
// owner rather than being global. The firewall only ever PINGS these devices (see the sweep in
// services.RunTopologyPingSweep and the on-demand check below); it never logs in to them, so there
// are no credentials to hold and nothing here reaches a device except `execute ping` through the
// shared diag gate.

type deviceRequest struct {
	Name                string `json:"name"`
	Description         string `json:"description"`
	IPAddress           string `json:"ip_address"`
	Kind                string `json:"kind"`
	PingIntervalSeconds int    `json:"ping_interval_seconds"`
	Enabled             *bool  `json:"enabled"`
	DeviceID            uint   `json:"device_id"`
}

func getUserID(c *gin.Context) (uint, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

func isAdmin(c *gin.Context) bool { return c.GetString("user_role") == "admin" }

// allowedPingingFirewall checks the OTHER id on a pin: not who owns it, but which firewall is told
// to do the pinging.
//
// find() scopes the owner, so a pin cannot be read or edited by anybody else. device_id was only
// ever checked for existence, which is not the same question: it names a firewall this server then
// LOGS IN TO and runs `execute ping <ip>` on. Left ungated, any signed-in user could pin a host and
// have a firewall they were never granted probe it — a host scanner pivoting through somebody
// else's device, including the production one — and because every check logs in, it also spends
// attempts against an account FortiOS locks after three failures.
//
// The access check runs FIRST, and the order is the point: UserCanAccessDevice is false both for an
// id that does not exist and for one that was never granted, so a non-admin is answered 404 either
// way and learns nothing about which firewalls this console holds — the same reasoning as
// controller/devicecredential. An admin passes it unconditionally, so the clearer "does not exist"
// message below is still what a typo gets from the person who can act on it.
func allowedPingingFirewall(c *gin.Context, userID, deviceID uint) bool {
	db := config.DB()
	if !services.UserCanAccessDevice(db, userID, isAdmin(c), deviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return false
	}
	var fwCount int64
	db.Model(&entity.NetworkDevice{}).Where("id = ?", deviceID).Count(&fwCount)
	if fwCount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the firewall that would ping this device does not exist"})
		return false
	}
	return true
}

// normalise validates and cleans a request into the fields that may be written. Shared by create and
// update so the two cannot disagree about what a valid device is.
func normalise(req deviceRequest) (name, desc, ip, kind string, interval int, deviceID uint, err string) {
	name = strings.TrimSpace(req.Name)
	if name == "" {
		return "", "", "", "", 0, 0, "name is required"
	}
	if len(name) > 100 {
		return "", "", "", "", 0, 0, "name is too long (max 100)"
	}

	ip = strings.TrimSpace(req.IPAddress)
	if ip == "" {
		return "", "", "", "", 0, 0, "IP address is required"
	}
	// A real IP, not a hostname: the value is pinged on a live firewall's CLI, and an address that
	// parses is the only safe thing to paste there. (The command path also re-guards it through
	// services.ValidateDiagTarget.)
	if net.ParseIP(ip) == nil {
		return "", "", "", "", 0, 0, "IP address is not a valid IPv4 or IPv6 address"
	}

	kind = strings.TrimSpace(req.Kind)
	if kind == "" {
		kind = "other"
	}
	if !entity.ValidTopologyKind(kind) {
		return "", "", "", "", 0, 0, "unknown device kind"
	}

	interval = req.PingIntervalSeconds
	if interval == 0 {
		interval = 60
	}
	if interval < entity.MinPingInterval {
		interval = entity.MinPingInterval
	}
	if interval > entity.MaxPingInterval {
		interval = entity.MaxPingInterval
	}

	deviceID = req.DeviceID
	if deviceID == 0 {
		deviceID = 1
	}

	// services.TruncateUTF8, not desc[:500]: `len` counts BYTES and a Thai character is three of
	// them, so a plain slice lands mid-character and hands Postgres an invalid UTF-8 sequence. The
	// INSERT is then rejected outright and a legitimate create answers 500 — for a description
	// field nobody would guess was the cause.
	desc = platform.TruncateUTF8(strings.TrimSpace(req.Description), 500)
	return name, desc, ip, kind, interval, deviceID, ""
}

// List returns the signed-in user's own pinned devices.
func List(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var devices []entity.TopologyDevice
	if err := config.DB().Where("owner_user_id = ?", userID).
		Order("created_at ASC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list devices"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": devices})
}

// Create adds a device for the signed-in user.
func Create(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req deviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name, desc, ip, kind, interval, deviceID, verr := normalise(req)
	if verr != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": verr})
		return
	}
	// The firewall that will do the pinging must exist AND be one this caller was granted. Without
	// the existence half, a typo in device_id creates a row the sweep can never service, which shows
	// on the map as a device stuck "unknown" forever; without the access half, see
	// allowedPingingFirewall.
	if !allowedPingingFirewall(c, userID, deviceID) {
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	device := entity.TopologyDevice{
		OwnerUserID:         userID,
		DeviceID:            deviceID,
		Name:                name,
		Description:         desc,
		IPAddress:           ip,
		Kind:                kind,
		PingIntervalSeconds: interval,
		Enabled:             enabled,
		LastStatus:          entity.TopologyStatusUnknown,
	}
	if err := config.DB().Create(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create device"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": device})
}

// find loads one device owned by this user, or writes the 404/401 and returns false.
func find(c *gin.Context) (entity.TopologyDevice, bool) {
	var device entity.TopologyDevice
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return device, false
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return device, false
	}
	if err := config.DB().Where("id = ? AND owner_user_id = ?", id, userID).
		First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return device, false
	}
	return device, true
}

// Update edits one of the user's devices.
func Update(c *gin.Context) {
	device, ok := find(c)
	if !ok {
		return
	}
	var req deviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name, desc, ip, kind, interval, deviceID, verr := normalise(req)
	if verr != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": verr})
		return
	}
	// An edit may MOVE the pin to another firewall, so the id is re-checked exactly as on create —
	// otherwise the gate would only have to be walked around once.
	if !allowedPingingFirewall(c, device.OwnerUserID, deviceID) {
		return
	}

	device.Name = name
	device.Description = desc
	device.Kind = kind
	device.PingIntervalSeconds = interval
	device.DeviceID = deviceID
	if req.Enabled != nil {
		device.Enabled = *req.Enabled
	}
	// Changing the address invalidates the last reading — it was about a different host. Reset to
	// unknown so the map does not show the new target wearing the old one's green.
	if ip != device.IPAddress {
		device.IPAddress = ip
		device.LastStatus = entity.TopologyStatusUnknown
		device.LastLatencyMs = nil
		device.LastLossPercent = nil
		device.LastCheckedAt = nil
		device.LastError = ""
	}

	if err := config.DB().Save(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update device"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": device})
}

// Delete removes one of the user's devices.
func Delete(c *gin.Context) {
	device, ok := find(c)
	if !ok {
		return
	}
	if err := config.DB().Delete(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete device"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "device deleted"})
}

// CheckNow pings one device immediately and returns the fresh reading, so a user who just added a
// device sees up/down without waiting for the next sweep. It runs through the SAME diag gate and
// automation-login path as the sweep, so it is bound by the same per-firewall lock and breaker.
func CheckNow(c *gin.Context) {
	device, ok := find(c)
	if !ok {
		return
	}

	// Re-checked here rather than trusted because the row exists: a pin may predate the grant check
	// in Create/Update, or outlive a grant an admin has since revoked, and this is the call that
	// actually logs in to a firewall.
	if !services.UserCanAccessDevice(config.DB(), device.OwnerUserID, isAdmin(c), device.DeviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	var fw entity.NetworkDevice
	if err := config.DB().First(&fw, device.DeviceID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the pinging firewall does not exist"})
		return
	}
	login, err := services.ResolveAutomationLogin(config.DB(), &fw)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	target := services.DiagTarget{
		DeviceID: fw.ID, Host: fw.MgmtIP, Port: fw.Port,
		Username: login.Username, Password: login.Password,
	}

	status := entity.TopologyStatusUnknown
	var latency *float64
	var loss *int
	lastErr := ""
	result, perr := services.PingOnce(target, device.IPAddress, services.PingOptions{Count: 3})
	if perr != nil {
		lastErr = platform.TruncateUTF8(perr.Error(), 300)
	} else {
		status = services.PingReachable(result)
		l := result.LossPercent
		loss = &l
		if result.Received > 0 {
			avg := result.AvgMs
			latency = &avg
		}
	}

	now := time.Now()
	device.LastStatus = status
	device.LastLatencyMs = latency
	device.LastLossPercent = loss
	device.LastCheckedAt = &now
	device.LastError = lastErr
	config.DB().Model(&entity.TopologyDevice{}).Where("id = ?", device.ID).Updates(map[string]any{
		"last_status":       status,
		"last_latency_ms":   latency,
		"last_loss_percent": loss,
		"last_checked_at":   now,
		"last_error":        lastErr,
	})

	c.JSON(http.StatusOK, gin.H{"data": device})
}

// CheckAll re-pings every one of the caller's ENABLED pinned devices right now and returns the fresh
// list. The Topology page calls it on open so the map confirms what is actually up this second,
// rather than leaving a device coloured from a scheduled check that may be minutes old — the user
// asked not to be left looking at a stale "down" on a device that is in fact still up.
//
// Optional ?device_id= scopes it to the firewall currently in view (the only one whose pins the map
// is drawing); without it, every firewall the caller has pins on is covered. Like the sweep and
// CheckNow it resolves one automation login per firewall and pings through the same diag gate, so it
// stays inside the per-firewall lock/breaker that protects the device's admin-lockout threshold —
// which is also why the pings run sequentially rather than in a burst.
func CheckAll(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	q := config.DB().Where("owner_user_id = ? AND enabled = ?", userID, true)
	// Scope to one firewall when the page says which it is showing. 0 / absent = all of them.
	if raw := strings.TrimSpace(c.Query("device_id")); raw != "" {
		if fwID, err := strconv.ParseUint(raw, 10, 64); err == nil && fwID > 0 {
			q = q.Where("device_id = ?", fwID)
		}
	}

	var devices []entity.TopologyDevice
	if err := q.Order("created_at ASC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list devices"})
		return
	}

	// One automation login per firewall, reused for every pin on it — mirrors RunTopologyPingSweep so
	// the two cannot drift in how they reach a device.
	type fwConn struct {
		target services.DiagTarget
		ok     bool
		err    string
	}
	conns := map[uint]*fwConn{}
	admin := isAdmin(c)
	resolve := func(id uint) *fwConn {
		if f, ok := conns[id]; ok {
			return f
		}
		f := &fwConn{}
		conns[id] = f
		// Same re-check as CheckNow, and for the same reason: the ?device_id= filter can only
		// NARROW the caller's own rows, but a row already in the table may name a firewall this
		// person was never granted (or no longer is). The pin stays listed and simply reports why
		// it was not checked — it is their own row, so the reason is theirs to see.
		if !services.UserCanAccessDevice(config.DB(), userID, admin, id) {
			f.err = "you do not have access to the firewall that pings this device"
			return f
		}
		var fw entity.NetworkDevice
		if err := config.DB().First(&fw, id).Error; err != nil {
			f.err = "the pinging firewall does not exist"
			return f
		}
		login, err := services.ResolveAutomationLogin(config.DB(), &fw)
		if err != nil {
			f.err = platform.TruncateUTF8(err.Error(), 300)
			return f
		}
		f.target = services.DiagTarget{
			DeviceID: fw.ID, Host: fw.MgmtIP, Port: fw.Port,
			Username: login.Username, Password: login.Password,
		}
		f.ok = true
		return f
	}

	for i := range devices {
		d := &devices[i]
		status := entity.TopologyStatusUnknown
		var latency *float64
		var loss *int
		lastErr := ""

		conn := resolve(d.DeviceID)
		if !conn.ok {
			lastErr = conn.err
		} else if result, perr := services.PingOnce(conn.target, d.IPAddress, services.PingOptions{Count: 3}); perr != nil {
			lastErr = platform.TruncateUTF8(perr.Error(), 300)
		} else {
			status = services.PingReachable(result)
			l := result.LossPercent
			loss = &l
			if result.Received > 0 {
				avg := result.AvgMs
				latency = &avg
			}
		}

		now := time.Now()
		d.LastStatus = status
		d.LastLatencyMs = latency
		d.LastLossPercent = loss
		d.LastCheckedAt = &now
		d.LastError = lastErr
		config.DB().Model(&entity.TopologyDevice{}).Where("id = ?", d.ID).Updates(map[string]any{
			"last_status":       status,
			"last_latency_ms":   latency,
			"last_loss_percent": loss,
			"last_checked_at":   now,
			"last_error":        lastErr,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": devices})
}
