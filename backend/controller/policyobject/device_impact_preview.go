package policyobject

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"network_automation/services"
)

// impactPreviewInput is the request body for POST .../firewall-policies/impact-preview.
//
// Mirrors the four real ways a policy is changed (see device_proxy.go's create/delete/move and
// device_policy_update.go's PATCH) rather than inventing a new vocabulary: "op" is exactly the
// operation the caller is about to perform for real, once they are satisfied with what this
// previews.
type impactPreviewInput struct {
	OpName   string      `json:"op"` // "create" | "update" | "delete" | "move"
	PolicyID int         `json:"policy_id,omitempty"`
	Policy   policyInput `json:"policy"`
	Position string      `json:"position,omitempty"`
	RefID    int         `json:"ref_id,omitempty"`
}

// POST /policy/device/:deviceId/firewall-policies/impact-preview
//
// "What would this change actually have done" — replays the firewall's own recent, real traffic
// through the policy table as it is now and as the proposed change would leave it, and reports
// which sessions would get a different verdict. Writes nothing; see
// services.PreviewPolicyChangeImpact for the engine and why it replays real sessions rather than a
// synthetic sweep.
//
// Open to the same people who may already SEE the policy table (not admin-gated): previewing a
// change is strictly less than making one, and the maker-checker Change Request flow (a non-admin
// proposing a change for an admin to approve) is exactly the caller who most needs to see this
// before asking.
func DeviceImpactPreview(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	var inp impactPreviewInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	op := services.ImpactPreviewOp(inp.OpName)
	change := services.ImpactPreviewChange{
		Op: op, PolicyID: inp.PolicyID, Position: inp.Position, RefID: inp.RefID,
	}
	switch op {
	case services.ImpactCreate, services.ImpactUpdate:
		if inp.Policy.SrcIntf == "" && len(inp.Policy.SrcIntfList) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "the proposed policy needs at least a source and destination interface to preview"})
			return
		}
		change.Policy = policyInputToFGPolicy(inp.Policy)
	case services.ImpactDelete, services.ImpactMove:
		// No policy content needed — PolicyID (and RefID, for a move) is the whole change.
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "op must be one of create, update, delete, move"})
		return
	}
	if (op == services.ImpactUpdate || op == services.ImpactDelete || op == services.ImpactMove) && inp.PolicyID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "policy_id is required for update, delete and move"})
		return
	}
	if op == services.ImpactMove && inp.RefID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ref_id is required for move"})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	result, err := fc.PreviewPolicyChangeImpact(change)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
