package policyobject

import (
	"errors"
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Policy & Objects ▸ Address Groups and Service Groups — the device proxy for the two grouping
// object types (see services/fortigate_group.go for the schema and its traps).
//
// Every handler is the standard two-line opening: getDeviceInfo resolves the device, the caller's
// access to it and which firewall account to log in as; buildClient takes a pooled session bound
// to this request. Neither is re-implemented here, and neither is the permission check — writes
// go through requireAdminPO like every other device write in this package.

// groupInput is the create/edit payload both group forms send. The two object types share it
// because the form is the same shape: a name, a member list, and a handful of flags.
type groupInput struct {
	Name           string   `json:"name"`
	Type           string   `json:"type"` // address groups only: default | folder
	Members        []string `json:"members"`
	Exclude        bool     `json:"exclude"`         // address groups only
	ExcludeMembers []string `json:"exclude_members"` // address groups only
	AllowRouting   bool     `json:"allow_routing"`   // address groups only
	Proxy          bool     `json:"proxy"`           // service groups only
	FabricObject   bool     `json:"fabric_object"`
	Comment        string   `json:"comment"`
	Color          int      `json:"color"`
}

// validateGroup rejects what the device would reject anyway, but with a sentence instead of a
// numeric code — and catches the one case FortiOS accepts and should not.
//
// The empty-member check is the important one. A group with no members is syntactically valid to
// POST but matches nothing, so a policy referencing it silently passes no traffic. That is the
// worst failure mode available here: the rule looks right in the table and does nothing.
func validateGroup(inp groupInput, kind string) string {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return "name is required"
	}
	if len(name) > 79 {
		return "name is too long — FortiOS allows 79 characters"
	}
	if len(inp.Members) == 0 {
		// "an address group", "a service group" — the article follows the kind, not the phrase.
		article := "a"
		if strings.ContainsAny(kind[:1], "aeiou") {
			article = "an"
		}
		return article + " " + kind + " group needs at least one member — an empty group matches " +
			"nothing, so a policy that uses it would silently pass no traffic"
	}
	for _, m := range inp.Members {
		if strings.TrimSpace(m) == "" {
			return "a member name is empty"
		}
		if strings.EqualFold(m, name) {
			return "a group cannot contain itself"
		}
	}
	if inp.Exclude && len(inp.ExcludeMembers) == 0 {
		return "exclude is on but no excluded member is listed"
	}
	return ""
}

func addrGroupFrom(inp groupInput) services.FGAddressGroup {
	return services.FGAddressGroup{
		Name:           strings.TrimSpace(inp.Name),
		Type:           inp.Type,
		Members:        inp.Members,
		Exclude:        inp.Exclude,
		ExcludeMembers: inp.ExcludeMembers,
		AllowRouting:   inp.AllowRouting,
		FabricObject:   inp.FabricObject,
		Comment:        inp.Comment,
		Color:          inp.Color,
	}
}

func svcGroupFrom(inp groupInput) services.FGServiceGroup {
	return services.FGServiceGroup{
		Name:         strings.TrimSpace(inp.Name),
		Members:      inp.Members,
		Proxy:        inp.Proxy,
		FabricObject: inp.FabricObject,
		Comment:      inp.Comment,
		Color:        inp.Color,
	}
}

// ── Address groups ───────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/address-groups
func DeviceListAddressGroups(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	groups, err := fc.GetAddressGroupsFull()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, groups)
}

// GET /policy/device/:deviceId/address-groups/:name
func DeviceGetAddressGroup(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	g, err := fc.GetAddressGroup(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, g)
}

// POST /policy/device/:deviceId/address-groups
func DeviceCreateAddressGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp groupInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateGroup(inp, "address"); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.CreateAddressGroup(addrGroupFrom(inp)); err != nil {
		if errors.Is(err, services.ErrAllowRoutingDiscarded) {
			// The group IS on the device. Reporting this as a failure would send the operator
			// looking for an object that exists; reporting it as a clean success would leave them
			// with a toggle that silently turned itself off. It is neither, so it says so.
			c.JSON(http.StatusCreated, gin.H{
				"message": "address group created on device",
				"warning": err.Error(),
			})
			return
		}
		respondDeviceError(c, err, "address group")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "address group created on device"})
}

// PATCH /policy/device/:deviceId/address-groups/:name
func DeviceUpdateAddressGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp groupInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateGroup(inp, "address"); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.UpdateAddressGroup(c.Param("name"), addrGroupFrom(inp)); err != nil {
		if errors.Is(err, services.ErrAllowRoutingDiscarded) {
			c.JSON(http.StatusOK, gin.H{
				"message": "address group updated on device",
				"warning": err.Error(),
			})
			return
		}
		respondDeviceError(c, err, "address group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "address group updated on device"})
}

// DELETE /policy/device/:deviceId/address-groups/:name
func DeviceDeleteAddressGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	if err := fc.DeleteAddressGroup(c.Param("name")); err != nil {
		respondDeviceError(c, err, "address group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "address group deleted from device"})
}

// ── Service groups ───────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/service-groups
func DeviceListServiceGroups(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	groups, err := fc.GetServiceGroupsFull()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, groups)
}

// GET /policy/device/:deviceId/service-groups/:name
func DeviceGetServiceGroup(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	g, err := fc.GetServiceGroup(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, g)
}

// POST /policy/device/:deviceId/service-groups
func DeviceCreateServiceGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp groupInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateGroup(inp, "service"); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.CreateServiceGroup(svcGroupFrom(inp)); err != nil {
		respondDeviceError(c, err, "service group")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "service group created on device"})
}

// PATCH /policy/device/:deviceId/service-groups/:name
func DeviceUpdateServiceGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp groupInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateGroup(inp, "service"); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.UpdateServiceGroup(c.Param("name"), svcGroupFrom(inp)); err != nil {
		respondDeviceError(c, err, "service group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "service group updated on device"})
}

// DELETE /policy/device/:deviceId/service-groups/:name
func DeviceDeleteServiceGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	if err := fc.DeleteServiceGroup(c.Param("name")); err != nil {
		respondDeviceError(c, err, "service group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "service group deleted from device"})
}
