package policyobject

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// GET /policy/device/:deviceId/security-profiles/:category
// category is one of: antivirus, webfilter, dnsfilter, application-control, file-filter,
// ssl-ssh-inspection, ips
func DeviceListSecurityProfiles(c *gin.Context) {
	category := c.Param("category")
	if !services.IsValidSecurityProfileCategory(category) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown security profile category"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	profiles, err := fc.GetSecurityProfiles(category)
	if err != nil {
		respondDeviceError(c, err, category+" profile")
		return
	}

	// ReadOnly marks objects FortiOS itself refuses to modify, so the list page can grey the
	// Edit/Delete buttons instead of offering a form whose save is guaranteed to fail. Today only
	// SSL/SSH Inspection has any: FortiOS ships three locked profiles and one (custom-deep-
	// inspection) that exists to be edited.
	type ProfileFE struct {
		Name     string `json:"name"`
		Comment  string `json:"comment"`
		ReadOnly bool   `json:"readonly"`
	}
	result := make([]ProfileFE, 0, len(profiles))
	for _, p := range profiles {
		result = append(result, ProfileFE{
			Name:     p.Name,
			Comment:  p.Comment,
			ReadOnly: category == "ssl-ssh-inspection" && services.IsBuiltinSSLProfile(p.Name),
		})
	}
	c.JSON(http.StatusOK, result)
}

// isFormCategory reports whether a full create/edit form is wired up for this category.
// Categories without one still list/delete, but return 501 for get-detail/create/update.
func isFormCategory(category string) bool {
	switch category {
	case "antivirus", "webfilter", "dnsfilter", "application-control", "file-filter",
		"ssl-ssh-inspection", "ips":
		return true
	}
	return false
}

// GET /policy/device/:deviceId/security-profiles/:category/:name — full detail for the
// edit form. Only categories in isFormCategory are implemented; the rest return 501 until
// their create/update forms are built.
func DeviceGetSecurityProfile(c *gin.Context) {
	category := c.Param("category")
	if !isFormCategory(category) {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "create/edit is not yet implemented for this category"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	name := c.Param("name")
	var (
		form interface{}
		err  error
	)
	switch category {
	case "antivirus":
		form, err = fc.GetAVProfile(name)
	case "webfilter":
		form, err = fc.GetWebFilterProfile(name)
	case "dnsfilter":
		form, err = fc.GetDNSFilterProfile(name)
	case "application-control":
		form, err = fc.GetAppControlProfile(name)
	case "file-filter":
		form, err = fc.GetFileFilterProfile(name)
	case "ssl-ssh-inspection":
		form, err = fc.GetSSLSSHProfile(name)
	case "ips":
		form, err = fc.GetIPSSensor(name)
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, form)
}

// GET /policy/device/:deviceId/antivirus-capabilities — device-side signals the AntiVirus
// create/edit form uses to grey out options the real FortiGate GUI also greys out
// (FortiSandbox connector present? FortiGuard AntiVirus subscription active?).
func DeviceGetAVCapabilities(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetAVProfileCapabilities())
}

// GET /policy/device/:deviceId/webfilter-metadata — the FortiGuard category taxonomy plus
// the picker lists the Web Filter create/edit form needs (user groups, other profiles,
// license state). `?self=<name>` excludes the profile being edited from the profile picker.
func DeviceGetWebFilterMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetWebFilterMetadata(c.Query("self")))
}

// GET /policy/device/:deviceId/dnsfilter-metadata — the FortiGuard category taxonomy the DNS
// Filter form's category grid renders, plus the two licence signals the real GUI warns about
// (FortiGuard web-filtering rating, botnet C&C package) and the external-resource picker list.
func DeviceGetDNSFilterMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetDNSFilterMetadata())
}

// GET /policy/device/:deviceId/appcontrol-metadata — the FortiGuard application category
// taxonomy plus the Filter-override attribute values and (when available) the live
// application signature database the Application Control create/edit form needs.
//
// This is the largest response the console serves — 291 KB, almost all of it the device's
// 2,414-signature database — and the form re-requests it on every open. It goes out with an ETag
// so a browser that already has that exact payload gets a 304 instead (see httpcache.go); the
// signature list itself is already cached server-side for 30 minutes, so the round trip is cheap
// and what this saves is the transfer.
func DeviceGetAppControlMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	writeRevalidatedJSON(c, fc.GetAppControlMetadata())
}

// GET /policy/device/:deviceId/filefilter-metadata — the file-type catalogue (for the rule
// drawer's "Select Entries" list) plus the protocol option set the File Filter form needs.
func DeviceGetFileFilterMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetFileFilterMetadata())
}

// GET /policy/device/:deviceId/ips-metadata — the filter-option catalogue and signature list
// the IPS Sensor form's pickers need.
//
// Derived from the device's own signature database (5,864 entries on the lab unit), so the
// dropdowns offer values that device actually has rather than a hard-coded guess. Sent with an
// ETag for the same reason the Application Control metadata is: it is a large payload the form
// re-requests on every open, and it changes only when FortiGuard pushes an update.
func DeviceGetIPSMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	writeRevalidatedJSON(c, fc.GetIPSMetadata())
}

// GET /policy/device/:deviceId/sslssh-metadata — certificate, address and FortiGuard-category
// pickers for the SSL/SSH Inspection form, plus the per-protocol default ports and the list of
// built-in profiles the list page greys out.
func DeviceGetSSLSSHMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetSSLSSHMetadata())
}

// POST /policy/device/:deviceId/security-profiles/:category
func DeviceCreateSecurityProfile(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	category := c.Param("category")
	if !isFormCategory(category) {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "create is not yet implemented for this category"})
		return
	}

	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	// Bind + name-check + create, per category. Each category has its own GUI-shaped form.
	// validate is optional — set it where the device has constraints the schema doesn't state.
	var (
		name     string
		bindErr  error
		validate func() error
		create   func(fc deviceClient) error
	)
	switch category {
	case "antivirus":
		var form services.AVProfileForm
		bindErr = c.ShouldBindJSON(&form)
		name = form.Name
		create = func(fc deviceClient) error { return fc.CreateAVProfile(form) }
	case "webfilter":
		var form services.WebFilterProfileForm
		bindErr = c.ShouldBindJSON(&form)
		name = form.Name
		create = func(fc deviceClient) error { return fc.CreateWebFilterProfile(form) }
	case "dnsfilter":
		var form services.DNSFilterProfileForm
		bindErr = c.ShouldBindJSON(&form)
		name = form.Name
		// Catch bad domain types/actions and malformed IPs before the device answers -3/-651.
		validate = func() error { return services.ValidateDNSFilterForm(form) }
		create = func(fc deviceClient) error { return fc.CreateDNSFilterProfile(form) }
	case "application-control":
		var form services.AppControlProfileForm
		bindErr = c.ShouldBindJSON(&form)
		name = form.Name
		create = func(fc deviceClient) error { return fc.CreateAppControlProfile(form) }
	case "file-filter":
		var form services.FileFilterProfileForm
		bindErr = c.ShouldBindJSON(&form)
		name = form.Name
		// Catch the runtime-only rule constraints (password-protected file types, empty file
		// type list) before the device answers with a bare -3/-61.
		validate = func() error { return services.ValidateFileFilterForm(form) }
		create = func(fc deviceClient) error { return fc.CreateFileFilterProfile(form) }
	case "ssl-ssh-inspection":
		var form services.SSLSSHProfileForm
		bindErr = c.ShouldBindJSON(&form)
		name = form.Name
		validate = func() error { return services.ValidateSSLSSHProfileForm(form) }
		create = func(fc deviceClient) error { return fc.CreateSSLSSHProfile(form) }
	case "ips":
		var form services.IPSSensorForm
		bindErr = c.ShouldBindJSON(&form)
		name = form.Name
		validate = func() error { return services.ValidateIPSSensorForm(form) }
		create = func(fc deviceClient) error { return fc.CreateIPSSensor(form) }
	}
	if bindErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": bindErr.Error()})
		return
	}
	if strings.TrimSpace(name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if validate != nil {
		if err := validate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := create(fc); err != nil {
		respondDeviceError(c, err, category+" profile")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": category + " profile created on device"})
}

// PATCH /policy/device/:deviceId/security-profiles/:category/:name
func DeviceUpdateSecurityProfile(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	category := c.Param("category")
	if !isFormCategory(category) {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "update is not yet implemented for this category"})
		return
	}

	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")

	var (
		bindErr  error
		validate func() error
		update   func(fc deviceClient) error
	)
	switch category {
	case "antivirus":
		var form services.AVProfileForm
		bindErr = c.ShouldBindJSON(&form)
		update = func(fc deviceClient) error { return fc.UpdateAVProfile(name, form) }
	case "webfilter":
		var form services.WebFilterProfileForm
		bindErr = c.ShouldBindJSON(&form)
		update = func(fc deviceClient) error { return fc.UpdateWebFilterProfile(name, form) }
	case "dnsfilter":
		var form services.DNSFilterProfileForm
		bindErr = c.ShouldBindJSON(&form)
		// The profile being edited is the one in the URL. Name also names the Static Domain
		// Filter table the payload builder resolves, so an absent body name must not leave it "".
		if strings.TrimSpace(form.Name) == "" {
			form.Name = name
		}
		validate = func() error { return services.ValidateDNSFilterForm(form) }
		update = func(fc deviceClient) error { return fc.UpdateDNSFilterProfile(name, form) }
	case "application-control":
		var form services.AppControlProfileForm
		bindErr = c.ShouldBindJSON(&form)
		update = func(fc deviceClient) error { return fc.UpdateAppControlProfile(name, form) }
	case "file-filter":
		var form services.FileFilterProfileForm
		bindErr = c.ShouldBindJSON(&form)
		// Same runtime constraints as create — an update that flips "Password-protected only"
		// on while a non-archive type is still selected fails on the device with -61.
		validate = func() error { return services.ValidateFileFilterForm(form) }
		update = func(fc deviceClient) error { return fc.UpdateFileFilterProfile(name, form) }
	case "ssl-ssh-inspection":
		var form services.SSLSSHProfileForm
		bindErr = c.ShouldBindJSON(&form)
		if strings.TrimSpace(form.Name) == "" {
			form.Name = name
		}
		validate = func() error { return services.ValidateSSLSSHProfileForm(form) }
		update = func(fc deviceClient) error { return fc.UpdateSSLSSHProfile(name, form) }
	case "ips":
		var form services.IPSSensorForm
		bindErr = c.ShouldBindJSON(&form)
		if strings.TrimSpace(form.Name) == "" {
			form.Name = name
		}
		validate = func() error { return services.ValidateIPSSensorForm(form) }
		update = func(fc deviceClient) error { return fc.UpdateIPSSensor(name, form) }
	}
	if bindErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": bindErr.Error()})
		return
	}
	if validate != nil {
		if err := validate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := update(fc); err != nil {
		respondDeviceError(c, err, category+" profile")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": category + " profile updated on device"})
}

// DELETE /policy/device/:deviceId/security-profiles/:category/:name
func DeviceDeleteSecurityProfile(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	category := c.Param("category")
	if !services.IsValidSecurityProfileCategory(category) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown security profile category"})
		return
	}

	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.DeleteSecurityProfile(category, name); err != nil {
		respondDeviceError(c, err, category+" profile")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "profile deleted from device"})
}
