package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"network_automation/services/platform"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var webfilterFtgdLocalRatingTable = cmdbPath{path: "webfilter/ftgd-local-rating", noun: "ftgd local rating"}

// Web Rating Overrides — webfilter/ftgd-local-rating.
//
// The FortiGate GUI's Security Profiles ▸ Web Rating Overrides page: "this URL is rated as THAT
// category, whatever FortiGuard says". One row = one URL, re-rated to one category.
//
// SCHEMA, verified live on 10.0.99.201 (FGT80E v7.2.10) via
// GET /api/v2/cmdb/webfilter/ftgd-local-rating?action=schema&vdom=root:
//
//	mkey     url       string(511), required   — the URL being re-rated
//	status   option    enable|disable, default enable
//	comment  var-string(255)
//	rating   "user"    required                — the target category, as its numeric ID
//
// Three things about `rating` that are easy to get wrong, all confirmed by probing the device:
//
//   - it is REQUIRED and it is an ID, not a name. The device accepts both 4 and "4" on the way in
//     but ALWAYS reads back the quoted form ("4"), so this file keeps it a string end to end;
//   - a custom category counts. ftgd-local-cat IDs (140, 141 on the lab box) are accepted here
//     exactly like a FortiGuard one, which is what the GUI's "Custom Categories" group offers;
//   - an ID the device does not know is rejected with `error -56`
//     ("node_check_object fail! for rating 9999"), not silently stored. So the form validates
//     against the device's own taxonomy rather than against a list written down here.
//
// The mkey is a URL and may contain slashes ("example.com/news/tech"). Percent-encoding them
// (%2F) works for GET, PUT and DELETE — verified live — which is why every by-key call below goes
// through url.PathEscape. And per the rule that cost this project a whole policy table once:
// DELETE always names an mkey, never the collection.

const webRatingPath = "/api/v2/cmdb/webfilter/ftgd-local-rating"

// The same table as a cmdbPath — see cmdbTable in fortigate_cmdb.go for why a delete has to
// name its mkey.
var webRatingTable = cmdbPath{path: "webfilter/ftgd-local-rating", noun: "web rating override"}

// WebRatingOverride is one row of the page, GUI-shaped.
//
// Category/CategoryGroup are RESOLVED, not stored: the device keeps only the ID. They are filled
// in from the same taxonomy the form's dropdowns are built from so the list can print
// "Potentially Liable / Illegal or Unethical" without a second round trip. An ID the taxonomy does
// not carry leaves them empty — the UI then shows the raw ID rather than inventing a name.
type WebRatingOverride struct {
	URL           string `json:"url"`
	Rating        string `json:"rating"`
	Status        bool   `json:"status"`
	Comment       string `json:"comment"`
	Category      string `json:"category"`
	CategoryGroup string `json:"category_group"`
}

// WebRatingMetadata is what the create/edit form's two dropdowns are built from: the device's own
// FortiGuard taxonomy (Category = group, Sub-Category = the categories inside it) plus the custom
// categories defined on the box, which the GUI lists as a final "Custom Categories" group.
type WebRatingMetadata struct {
	Categories        []FGWebFilterCategory `json:"categories"`
	LocalCategories   []FGWebFilterCategory `json:"local_categories"`
	WebFilterLicensed bool                  `json:"web_filter_licensed"`
}

// webRatingLocalGroup is the group label the GUI's override dialog puts custom categories under.
// The Web Filter profile form calls the same objects "Local Categories"; this page follows the
// dialog it is a copy of.
const webRatingLocalGroup = "Custom Categories"

// fgLooseString decodes a CMDB scalar the device may send either quoted or bare.
//
// `rating` reads back as "4" on 7.2.10, but its schema type is "user" rather than "integer", so
// nothing in the contract promises the quoting. Both forms land on the same Go string here, which
// costs one small type and removes a decode error that would otherwise empty the whole page.
type fgLooseString string

func (s *fgLooseString) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if len(b) == 0 || string(b) == "null" {
		*s = ""
		return nil
	}
	if b[0] == '"' {
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		*s = fgLooseString(str)
		return nil
	}
	*s = fgLooseString(strings.TrimSpace(string(b)))
	return nil
}

// fgWebRatingRow is the raw CMDB shape.
type fgWebRatingRow struct {
	URL     string        `json:"url"`
	Status  string        `json:"status"`
	Comment string        `json:"comment"`
	Rating  fgLooseString `json:"rating"`
}

func (r fgWebRatingRow) toOverride(byID map[string]FGWebFilterCategory) WebRatingOverride {
	o := WebRatingOverride{
		URL:     r.URL,
		Rating:  string(r.Rating),
		Status:  FGStringToBool(r.Status),
		Comment: r.Comment,
	}
	if cat, ok := byID[o.Rating]; ok {
		o.Category = cat.Name
		o.CategoryGroup = cat.Group
	}
	return o
}

// webRatingCategoryIndex maps category ID → category, across BOTH taxonomies a rating may point
// at: the FortiGuard tree (cached, ships with the firmware) and the device's custom categories
// (live — someone can add one at any moment and the page must not show its ID as unknown).
func (f *FortiClient) webRatingCategoryIndex() map[string]FGWebFilterCategory {
	meta := f.GetWebRatingMetadata()
	byID := make(map[string]FGWebFilterCategory, len(meta.Categories)+len(meta.LocalCategories))
	for _, c := range meta.Categories {
		byID[strconv.Itoa(c.ID)] = c
	}
	for _, c := range meta.LocalCategories {
		byID[strconv.Itoa(c.ID)] = c
	}
	return byID
}

// GetWebRatingMetadata gathers the two category lists and the licence signal the form needs.
//
// The FortiGuard taxonomy and the licence both come from the caches in fortigate_cache.go — they
// are the same reads the Web Filter and DNS Filter forms already make. The custom categories are
// NOT cached, for the reason every object list in this app stays live: a category created a moment
// ago has to be selectable, or the page pushes the user into creating a duplicate.
func (f *FortiClient) GetWebRatingMetadata() WebRatingMetadata {
	meta := WebRatingMetadata{}

	Parallel(
		func() { meta.Categories = f.fortiguardCategories() },

		// Drives the same warning the real dialog shows: "This device is not licensed for the
		// FortiGuard web filtering service." Overrides still SAVE without the licence — they just
		// have nothing to override until a rating lookup can happen.
		func() { meta.WebFilterLicensed = f.licenseStatuses()["web_filtering"] },

		func() {
			resp, err := f.do("GET", "/api/v2/cmdb/webfilter/ftgd-local-cat?fields=id,desc", nil)
			if err != nil {
				return
			}
			var rows []struct {
				ID   json.Number `json:"id"`
				Desc string      `json:"desc"`
			}
			if json.Unmarshal(resp.Results, &rows) != nil {
				return
			}
			for _, r := range rows {
				id, err := strconv.Atoi(r.ID.String())
				if err != nil {
					continue
				}
				meta.LocalCategories = append(meta.LocalCategories, FGWebFilterCategory{
					ID: id, Name: r.Desc, Group: webRatingLocalGroup, GroupID: 0,
				})
			}
		},
	)

	return meta
}

// GetWebRatingOverrides lists every override on the device.
func (f *FortiClient) GetWebRatingOverrides() ([]WebRatingOverride, error) {
	resp, err := f.do("GET", webRatingPath, nil)
	if err != nil {
		return nil, err
	}
	var rows []fgWebRatingRow
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("decode web rating overrides: %w", err)
	}

	byID := f.webRatingCategoryIndex()
	out := make([]WebRatingOverride, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.toOverride(byID))
	}
	return out, nil
}

// GetWebRatingOverride reads one override for the edit form.
func (f *FortiClient) GetWebRatingOverride(rawURL string) (WebRatingOverride, error) {
	resp, err := f.do("GET", webRatingPath+"/"+url.PathEscape(rawURL), nil)
	if err != nil {
		return WebRatingOverride{}, err
	}
	// A CMDB GET by mkey answers with a one-element array.
	var rows []fgWebRatingRow
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return WebRatingOverride{}, fmt.Errorf("decode web rating override: %w", err)
	}
	if len(rows) == 0 {
		return WebRatingOverride{}, fmt.Errorf("web rating override %q not found", rawURL)
	}
	return rows[0].toOverride(f.webRatingCategoryIndex()), nil
}

// webRatingPayload builds the CMDB body. Comment is cut on a rune boundary because the field caps
// at 255 and a byte-slice through a multi-byte character produces a string the device rejects.
func webRatingPayload(o WebRatingOverride) map[string]interface{} {
	return map[string]interface{}{
		"url":     strings.TrimSpace(o.URL),
		"rating":  strings.TrimSpace(o.Rating),
		"status":  FGBoolToString(o.Status),
		"comment": platform.TruncateUTF8(o.Comment, 255),
	}
}

// CreateWebRatingOverride adds one override.
func (f *FortiClient) CreateWebRatingOverride(o WebRatingOverride) error {
	err := webfilterFtgdLocalRatingTable.Create(f, webRatingPayload(o))
	return err
}

// UpdateWebRatingOverride rewrites the override keyed by originalURL.
//
// The URL is the mkey, so changing it renames the entry; FortiOS handles that from the body
// (verified live). The caller passes the key it loaded the form with, not the edited one.
func (f *FortiClient) UpdateWebRatingOverride(originalURL string, o WebRatingOverride) error {
	err := webfilterFtgdLocalRatingTable.Update(f, originalURL, webRatingPayload(o))
	return err
}

// DeleteWebRatingOverride removes one override BY MKEY.
//
// The mkey is not optional here and never becomes optional: a DELETE aimed at the collection URL
// wipes the whole table on this firmware, with no revision to restore from.
func (f *FortiClient) DeleteWebRatingOverride(rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		return fmt.Errorf("refusing to delete: no URL given")
	}
	return webRatingTable.Delete(f, rawURL)
}

// ── Rating lookup ────────────────────────────────────────────────────────────

// WebRatingLookup is the answer to the dialog's "Lookup rating" button.
//
// Fields is the device's own reply for that URL, passed through untouched. It is deliberately not
// parsed into named fields: on this lab device FortiGuard web filtering is unlicensed and
// POST monitor/utm/rating-lookup answers with nothing but the URL echoed back, so there was no
// licensed response to verify a shape against — and inventing key names for one is exactly the
// kind of guess this codebase gets punished for. Whatever a licensed device adds shows up here.
type WebRatingLookup struct {
	URL    string                     `json:"url"`
	Fields map[string]json.RawMessage `json:"fields"`
	// Rated is false when the device returned nothing beyond the URL — the normal answer without
	// a FortiGuard web-filtering contract.
	Rated bool `json:"rated"`
}

// LookupWebRating asks the device how FortiGuard currently rates a URL.
func (f *FortiClient) LookupWebRating(rawURL string) (WebRatingLookup, error) {
	target := strings.TrimSpace(rawURL)
	if target == "" {
		return WebRatingLookup{}, fmt.Errorf("a URL is required")
	}

	resp, err := f.do("POST", "/api/v2/monitor/utm/rating-lookup", map[string]interface{}{
		"url": []string{target},
	})
	if err != nil {
		return WebRatingLookup{}, err
	}

	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return WebRatingLookup{}, fmt.Errorf("decode rating lookup: %w", err)
	}
	if len(rows) == 0 {
		return WebRatingLookup{URL: target}, nil
	}

	out := WebRatingLookup{URL: target, Fields: map[string]json.RawMessage{}}
	for k, v := range rows[0] {
		if k == "url" {
			continue
		}
		out.Fields[k] = v
	}
	out.Rated = len(out.Fields) > 0
	return out, nil
}
