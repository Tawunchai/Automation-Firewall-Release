package middlewares

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// Change Audit Ledger — the recorder.
//
// Every device-proxy write passes through here. It sits in middleware rather than in the 40-odd
// handlers because the alternative — editing each one — guarantees the next handler someone adds is
// the one that goes unaudited. Working at the CMDB level (see services/changeledger.go) is what
// makes one generic recorder possible: a route tail resolves to a table plus an mkey, and those two
// are all a snapshot or a revert needs.
//
// Cost: one extra CMDB GET before an update or a delete, on the session the pool already holds
// open. Reads are untouched — the middleware returns immediately for anything that is not a write
// to a device-proxy route.
//
// Failure policy: the ledger must never break a change. Every error path here logs and continues;
// a change that could not be snapshotted is still recorded, with an empty Before and a note, so the
// timeline shows that it happened even when the detail is missing.

// devicePrefix is the one route family that reaches a live firewall.
const devicePrefix = "/policy/device/"

// ChangeRecorder returns the gin middleware that writes the ledger.
func ChangeRecorder() gin.HandlerFunc {
	return func(c *gin.Context) {
		target, deviceID, ok := resolveRequest(c)
		if !ok {
			c.Next()
			return
		}

		// Read the request body so it can be inspected after the handler has consumed it. Gin
		// hands the handler a stream, so it has to be buffered and put back.
		reqBody := drainRequestBody(c)

		fc := clientForDevice(c, deviceID)

		// A policy move changes where the policy sits, not what it says, so its row records a PLACE
		// rather than a body: the order is read before the move, and the row's After says where the
		// policy went and where it came from (services/changeledger_move.go). Recording a body — the
		// old way — made Revert replay an unchanged policy and call that an undo.
		move := isPolicyMove(c, target)
		var before, moveAfter json.RawMessage
		switch {
		case move:
			var order []int
			if fc != nil {
				order, _ = fc.PolicyOrder()
			}
			rec := services.MoveRecordFromRequest(order, services.PolicyIDOf(target.MKey), reqBody)
			moveAfter, _ = json.Marshal(rec)
		case fc != nil && target.MKey != "" && target.Action != services.ChangeActionCreate:
			before, _ = fc.SnapshotCMDBObject(target.CMDBPath, target.MKey)
		}

		// Capture the response so the created object's key can be read back out of it.
		rec := &responseRecorder{ResponseWriter: c.Writer, body: &bytes.Buffer{}}
		c.Writer = rec

		c.Next()

		status := rec.Status()
		// A rejected request never touched the firewall. Recording 400s would bury the real
		// changes under form-validation noise; a 5xx is a different story and is recorded as
		// failed, because "we tried and the device may or may not have applied it" is exactly the
		// thing an incident review needs to see.
		if status >= 200 && status < 300 {
			writeRecord(c, target, deviceID, before, moveAfter, reqBody, rec.body.Bytes(), fc, "")
			return
		}
		if status >= 500 {
			writeRecord(c, target, deviceID, before, moveAfter, reqBody, rec.body.Bytes(), nil,
				strings.TrimSpace(errorTextFrom(rec.body.Bytes())))
		}
	}
}

// isPolicyMove reports whether the request is PUT …/firewall-policies/<id>/move.
func isPolicyMove(c *gin.Context, target services.ChangeTarget) bool {
	return target.ResourceType == "firewall-policy" &&
		strings.HasSuffix(strings.TrimRight(c.Request.URL.EscapedPath(), "/"), "/move")
}

// resolveRequest decides whether this request is an auditable device write.
func resolveRequest(c *gin.Context) (services.ChangeTarget, uint, bool) {
	// EscapedPath, not Path: an mkey may itself contain a slash (a web rating override is keyed by
	// a URL like "example.com/news"), and the decoded Path would split that one key into two
	// segments — the ledger would then record "example.com" as the object that changed, and a
	// revert would aim at the wrong key. splitRouteTail decodes each segment afterwards, which is
	// what it was written to do.
	path := c.Request.URL.EscapedPath()
	if !strings.HasPrefix(path, devicePrefix) {
		return services.ChangeTarget{}, 0, false
	}
	switch c.Request.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return services.ChangeTarget{}, 0, false
	}

	deviceID, err := strconv.Atoi(c.Param("deviceId"))
	if err != nil || deviceID <= 0 {
		return services.ChangeTarget{}, 0, false
	}

	// Everything after "/policy/device/<id>/".
	tail := strings.TrimPrefix(path, devicePrefix)
	if idx := strings.Index(tail, "/"); idx >= 0 {
		tail = tail[idx+1:]
	} else {
		tail = ""
	}

	target, ok := services.ResolveChangeTarget(c.Request.Method, tail)
	return target, uint(deviceID), ok
}

// drainRequestBody buffers the request body and puts it back for the handler.
func drainRequestBody(c *gin.Context) []byte {
	if c.Request.Body == nil {
		return nil
	}
	b, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(b))
	return b
}

// clientForDevice builds a pooled FortiGate client for snapshotting.
//
// Returns nil rather than an error: no snapshot is a degraded ledger entry, not a failed request.
// The session comes from the same pool the handler is about to use, so this costs a lookup rather
// than a second login.
//
// It resolves the SAME account the handler will (services.ResolveDeviceLogin), and must keep doing
// so: the pool is keyed by username now that people can map their own device accounts, so
// snapshotting as the shared `admin` while the handler works as the caller would open a second
// session — a second login on a device that locks an account after three failures — instead of
// sharing the one the pool already holds.
func clientForDevice(c *gin.Context, deviceID uint) *services.FortiClient {
	db := config.DB()
	if db == nil {
		return nil
	}
	var device entity.NetworkDevice
	if err := db.First(&device, deviceID).Error; err != nil {
		return nil
	}
	uid, _ := c.Get("user_id")
	login, err := services.ResolveDeviceLogin(db, services.UserIDOf(uid), &device)
	if err != nil {
		return nil
	}
	fc, err := services.AcquireFortiClient(device.ID, device.MgmtIP, device.APIPort, login)
	if err != nil {
		return nil
	}
	return fc
}

// writeRecord persists one ledger row. afterOverride, when set, is the row's After as is — a move's
// place record — and no after-snapshot is taken.
func writeRecord(
	c *gin.Context,
	target services.ChangeTarget,
	deviceID uint,
	before, afterOverride json.RawMessage,
	reqBody, respBody []byte,
	fc *services.FortiClient,
	errText string,
) {
	// The AI Assistant holds its device snapshot for a minute (services.liveContextTTL), and a
	// write through this console is exactly the event that must not wait it out: "create the
	// address, then ask for the policy that uses it" would otherwise be answered against an
	// inventory from before the address existed, and the model would propose it again for a -5.
	// Done here, for every recorded write, for the same reason the ledger itself is in middleware.
	services.InvalidateLiveDeviceContext(deviceID)

	db := config.DB()
	if db == nil {
		return
	}

	mkey := target.MKey
	if mkey == "" {
		mkey = extractMKey(respBody, reqBody)
	}
	cmdbPath := target.CMDBPath
	if cmdbPath == "" {
		// The only route that gets here is a schedule create, whose table is chosen by the "type"
		// field in the request body.
		cmdbPath = schedulePathFromBody(reqBody)
	}

	after := afterOverride
	if after == nil && fc != nil && errText == "" && target.Action != services.ChangeActionDelete && mkey != "" && cmdbPath != "" {
		after, _ = fc.SnapshotCMDBObject(cmdbPath, mkey)
	}

	status := entity.ChangeStatusApplied
	if errText != "" {
		status = entity.ChangeStatusFailed
	}

	userID, _ := c.Get("user_id")
	uid, _ := userID.(uint)

	rec := entity.ChangeRecord{
		NetworkDeviceID: deviceID,
		AppUserID:       uid,
		UserEmail:       c.GetString("user_email"),
		Action:          target.Action,
		ResourceType:    target.ResourceType,
		CMDBPath:        cmdbPath,
		ResourceKey:     mkey,
		Method:          c.Request.Method,
		Path:            c.Request.URL.Path,
		Before:          string(before),
		After:           string(after),
		Status:          status,
		ErrorText:       errText,
	}
	if err := db.Create(&rec).Error; err != nil {
		// The change already happened. Losing its ledger row is bad, but failing the response
		// afterwards would be worse — the caller would retry a change that already applied.
		log.Printf("[ledger] failed to record %s %s: %v", rec.Method, rec.Path, err)
		return
	}

	// SIEM export (Phase C1) — a no-op unless an admin turned it on, and async even when on; see
	// services/siemexport.go for why this must never be able to slow down or fail a device write.
	services.ExportChangeRecordAsync(db, rec)
}

// schedulePathFromBody picks the schedule table from a create body.
//
// FortiOS splits schedules across three tables instead of discriminating on a field, so the type
// in the request body is the only thing that says which one a create landed in.
func schedulePathFromBody(body []byte) string {
	var b struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(body, &b) != nil {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(b.Type)) {
	case "recurring":
		return "/api/v2/cmdb/firewall.schedule/recurring"
	case "onetime":
		return "/api/v2/cmdb/firewall.schedule/onetime"
	case "group":
		return "/api/v2/cmdb/firewall.schedule/group"
	}
	return ""
}

// mkeyFields are the primary-key field names FortiOS uses, in the order they are worth trying.
// Almost every table is keyed by name; policies use policyid and static routes use seq-num.
var mkeyFields = []string{"policyid", "seq-num", "seq_num", "name"}

// extractMKey finds the created object's key.
//
// The response is tried first because the device assigns the key for tables with a numeric mkey —
// a policy create sends no policyid and gets one back. The request body is the fallback for the
// name-keyed tables, whose handlers answer with a bare message.
func extractMKey(respBody, reqBody []byte) string {
	if k := mkeyFromJSON(respBody, true); k != "" {
		return k
	}
	return mkeyFromJSON(reqBody, false)
}

func mkeyFromJSON(raw []byte, unwrapData bool) string {
	if len(raw) == 0 {
		return ""
	}
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil {
		return ""
	}
	if unwrapData {
		if data, ok := envelope["data"]; ok {
			var inner map[string]json.RawMessage
			if json.Unmarshal(data, &inner) == nil {
				if k := firstMKey(inner); k != "" {
					return k
				}
			}
		}
	}
	return firstMKey(envelope)
}

func firstMKey(obj map[string]json.RawMessage) string {
	for _, field := range mkeyFields {
		raw, ok := obj[field]
		if !ok {
			continue
		}
		var s string
		if json.Unmarshal(raw, &s) == nil && strings.TrimSpace(s) != "" {
			return s
		}
		var n json.Number
		if json.Unmarshal(raw, &n) == nil && n.String() != "" && n.String() != "0" {
			return n.String()
		}
	}
	return ""
}

// errorTextFrom pulls the message out of the app's standard {"error": "..."} body.
func errorTextFrom(body []byte) string {
	var e struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &e) != nil {
		return truncateLedgerText(string(body))
	}
	if e.Error != "" {
		return truncateLedgerText(e.Error)
	}
	return truncateLedgerText(e.Message)
}

// truncateLedgerText bounds what a device error can write into the table.
//
// The cut has to respect character boundaries, not just the byte budget. FortiGate error text is
// routinely Thai (comments, object names, FortiGuard category labels), and Thai characters are 3
// bytes each, so a plain s[:2000] lands mid-character roughly two times in three. That leaves a
// 1-2 byte fragment which is not valid UTF-8 — and Postgres rejects an invalid byte sequence for
// the whole INSERT, so writeRecord's db.Create fails and the row is lost with only a log line.
//
// The failure was invisible in the worst possible way: the rows it dropped were the ones recording
// a change that had FAILED, because those are the ones carrying a long device error in the first
// place. services.TruncateUTF8 is the same helper the FortiGate client already uses for exactly
// this, so there is one implementation of the rule rather than two.
func truncateLedgerText(s string) string {
	const max = 2000
	return platform.TruncateUTF8(s, max)
}

// ── response capture ─────────────────────────────────────────────────────────

// responseRecorder tees the handler's response into a buffer so the created object's key can be
// read from it after the fact.
type responseRecorder struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	// Bound the copy: a list endpoint could stream megabytes, and only the first few hundred bytes
	// of an object are ever needed to find its key. The remaining capacity is applied to THIS
	// write, not just checked before it — one 200 KB chunk would otherwise sail past the cap whole.
	const maxCapture = 64 * 1024
	if room := maxCapture - r.body.Len(); room > 0 {
		chunk := b
		if len(chunk) > room {
			chunk = chunk[:room]
		}
		r.body.Write(chunk) //nolint:errcheck // bytes.Buffer.Write never fails
	}
	return r.ResponseWriter.Write(b)
}

func (r *responseRecorder) WriteString(s string) (int, error) {
	return r.Write([]byte(s))
}
