package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Web Rating Overrides — device-proxy CRUD over webfilter/ftgd-local-rating.
//
// Mirrors the FortiGate GUI's Security Profiles ▸ Web Rating Overrides page and its
// "New Web Rating Override" dialog: URL, Comments, and the Category / Sub-Category pair that
// together pick ONE category ID — which is all the device actually stores.

// webRatingInput is the create/update body. `rating` is the category ID the two dropdowns
// resolve to; the UI sends the ID, not the name, because that is what the device keeps.
type webRatingInput struct {
	URL     string `json:"url"`
	Rating  string `json:"rating"`
	Status  *bool  `json:"status"`
	Comment string `json:"comment"`
}

// validateWebRating enforces what the dialog enforces, so a bad body comes back as a sentence
// instead of a FortiOS CLI parser error.
//
// It deliberately does NOT check the category ID against a list written down here: the valid IDs
// are the device's own taxonomy plus whatever custom categories exist on it, both of which change
// without this code. An ID the device does not know is refused by the device (error -56) and that
// message is passed through.
func validateWebRating(inp webRatingInput) (services.WebRatingOverride, error) {
	rawURL := strings.TrimSpace(inp.URL)
	if rawURL == "" {
		return services.WebRatingOverride{}, errMsg("a URL is required")
	}
	if len(rawURL) > 511 {
		return services.WebRatingOverride{}, errMsg("the URL is limited to 511 characters")
	}
	rating := strings.TrimSpace(inp.Rating)
	if rating == "" {
		return services.WebRatingOverride{}, errMsg("choose the category to override to")
	}
	if n, err := strconv.Atoi(rating); err != nil || n <= 0 {
		return services.WebRatingOverride{}, errMsg("the category must be a category ID")
	}

	// The dialog defaults a new override to enabled, matching the CMDB default.
	status := true
	if inp.Status != nil {
		status = *inp.Status
	}

	return services.WebRatingOverride{
		URL:     rawURL,
		Rating:  rating,
		Status:  status,
		Comment: strings.TrimSpace(inp.Comment),
	}, nil
}

// GET /policy/device/:deviceId/web-rating-overrides
func DeviceListWebRatingOverrides(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	items, err := fc.GetWebRatingOverrides()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

// GET /policy/device/:deviceId/web-rating-overrides/:url
func DeviceGetWebRatingOverride(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	item, err := fc.GetWebRatingOverride(c.Param("url"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

// GET /policy/device/:deviceId/web-rating-metadata — the FortiGuard category tree plus the
// device's custom categories, which is what the dialog's Category / Sub-Category dropdowns are
// built from, and the licence signal behind its warning banner.
func DeviceGetWebRatingMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetWebRatingMetadata())
}

// POST /policy/device/:deviceId/web-rating-overrides
func DeviceCreateWebRatingOverride(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp webRatingInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	o, err := validateWebRating(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateWebRatingOverride(o); err != nil {
		respondDeviceError(c, err, "web rating override")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "web rating override created on device"})
}

// PUT /policy/device/:deviceId/web-rating-overrides/:url
//
// :url is the key the form was LOADED with. The body may carry a different URL — that is a
// rename, which FortiOS applies from the body.
func DeviceUpdateWebRatingOverride(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp webRatingInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	o, err := validateWebRating(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateWebRatingOverride(c.Param("url"), o); err != nil {
		respondDeviceError(c, err, "web rating override")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "web rating override updated on device"})
}

// DELETE /policy/device/:deviceId/web-rating-overrides/:url
func DeviceDeleteWebRatingOverride(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteWebRatingOverride(c.Param("url")); err != nil {
		respondDeviceError(c, err, "web rating override")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "web rating override deleted from device"})
}

// POST /policy/device/:deviceId/web-rating-lookup — the dialog's "Lookup rating" button.
//
// A read, but a POST because the device's endpoint is one. Not gated on admin for that reason:
// it changes nothing, on the device or here.
func DeviceLookupWebRating(c *gin.Context) {
	var body struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(body.URL) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a URL is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	res, err := fc.LookupWebRating(body.URL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}
