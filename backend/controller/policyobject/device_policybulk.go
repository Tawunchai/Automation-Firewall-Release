package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Firewall Policy ▸ clone and bulk actions. Engine and its reasoning: services/fortigate_policybulk.go.
//
// Both are admin-only like every other write in this package. The bulk endpoints answer 207
// (Multi-Status) whenever any single policy failed, so a caller can never read a 200 as "all of
// them worked" — which is the failure mode a single boolean response would have.

// maxBulkPolicies caps one request. Not a device limit: it is the point past which "I selected the
// wrong thing" stops being recoverable by hand. Selecting more than fifty rules to delete at once
// is a script's job, and a script can call the endpoint fifty at a time and see each answer.
const maxBulkPolicies = 50

type clonePolicyInput struct {
	Name string `json:"name"`
}

type bulkPolicyInput struct {
	PolicyIDs []int `json:"policy_ids"`
}

// POST /policy/device/:deviceId/firewall-policies/:policyId/clone
func DeviceClonePolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("policyId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy id"})
		return
	}
	var inp clonePolicyInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a name for the copy is required"})
		return
	}
	if len(name) > 35 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "policy names are limited to 35 characters"})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	created, cloneErr := fc.ClonePolicy(id, name)
	if created == nil {
		respondDeviceError(c, cloneErr, "firewall policy")
		return
	}
	// created != nil with an error means the copy exists but could not be positioned. Reporting
	// that as a failure would be worse than reporting it as what it is — there is now a disabled
	// rule on the device either way, and the operator needs to know it is in the wrong place.
	if cloneErr != nil {
		c.JSON(http.StatusMultiStatus, gin.H{
			"message":  "policy cloned, but it could not be placed next to the original — it is at the end of the table",
			"warning":  cloneErr.Error(),
			"data":     created,
			"disabled": true,
		})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"message": "policy cloned on device — the copy is DISABLED and sits directly below the original",
		"data":    created,
	})
}

// bulkIDs validates and de-duplicates the id list shared by the three bulk endpoints.
func bulkIDs(c *gin.Context) ([]int, bool) {
	var inp bulkPolicyInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return nil, false
	}
	if len(inp.PolicyIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no policies selected"})
		return nil, false
	}
	seen := map[int]bool{}
	ids := make([]int, 0, len(inp.PolicyIDs))
	for _, id := range inp.PolicyIDs {
		if id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy id"})
			return nil, false
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) > maxBulkPolicies {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "too many policies in one request — " + strconv.Itoa(maxBulkPolicies) + " at a time",
		})
		return nil, false
	}
	return ids, true
}

// respondBulk answers 200 when everything worked and 207 when anything did not.
func respondBulk(c *gin.Context, results []services.BulkResult, verb string) {
	failed := 0
	for _, r := range results {
		if !r.OK {
			failed++
		}
	}
	status := http.StatusOK
	msg := strconv.Itoa(len(results)) + " policies " + verb
	if failed > 0 {
		status = http.StatusMultiStatus
		msg = strconv.Itoa(len(results)-failed) + " of " + strconv.Itoa(len(results)) +
			" policies " + verb + " — " + strconv.Itoa(failed) + " failed"
	}
	c.JSON(status, gin.H{"message": msg, "results": results, "failed": failed})
}

// PATCH /policy/device/:deviceId/firewall-policies/bulk/status
func DeviceBulkPolicyStatus(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	enable := c.Query("enable") != "false"

	// The body is read once; bulkIDs binds it, so the enable flag travels in the query string.
	ids, ok := bulkIDs(c)
	if !ok {
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	verb := "disabled"
	if enable {
		verb = "enabled"
	}
	respondBulk(c, fc.BulkPolicyStatus(ids, enable), verb)
}

// POST /policy/device/:deviceId/firewall-policies/bulk/delete
//
// POST rather than DELETE-with-a-body: a DELETE that carries a payload is allowed but widely
// mishandled by proxies, and this console sits behind nginx. It also keeps the rule easy to
// enforce — a DELETE to a collection URL is the one call that must never be made against a CMDB
// table, so no code path here should be able to emit one.
func DeviceBulkDeletePolicies(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	ids, ok := bulkIDs(c)
	if !ok {
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	respondBulk(c, fc.BulkDeletePolicies(ids), "deleted")
}
