package services

import "net/http"

// newTestClient builds a client pointed at an httptest server, already "logged in".
//
// The CSRF token moved onto the shared *fortiSession when FortiClient gained WithContext, so a
// struct literal can no longer set it — and several tests need it set, because do() sends it as
// X-CSRFTOKEN on every write and the fake servers assert on that.
func newTestClient(baseURL string, httpClient *http.Client) *FortiClient {
	fc := &FortiClient{BaseURL: baseURL, httpClient: httpClient, s: &fortiSession{}}
	fc.s.csrfToken = "test-csrf"
	return fc
}
