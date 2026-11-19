package services

import (
	"net/http"
	"testing"
)

// A live full-system check found that FortiOS refuses (-56) a webfilter/profile write that both
// enables `ovrd-perm`'s override flag AND changes `ovrd-dur` to anything other than what the
// object currently stores — a brand-new object's "currently stores" is FortiOS's own 15-minute
// factory default, which is why the symptom first looked like "only 15 minutes works". The fix
// (CreateWebFilterProfile / UpdateWebFilterProfile) splits a write that enables override into two:
// the new duration first with override OFF (always accepted), then override turned on in a second
// write where the duration already matches. These tests pin that split using fakeFortiGate (shared
// with fortigate_dnsfilter_test.go, same package).

func wfForm(over func(*WebFilterProfileForm)) WebFilterProfileForm {
	f := WebFilterProfileForm{
		Name:                     "wf1",
		Comment:                  "c",
		FortiGuardCategoryFilter: true,
		HTTPPostAction:           "allow",
	}
	if over != nil {
		over(&f)
	}
	return f
}

func TestCreateWebFilterProfile_OverrideOffIsOneWrite(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	form := wfForm(nil) // AllowOverride defaults to false
	if err := fc.CreateWebFilterProfile(form); err != nil {
		t.Fatalf("CreateWebFilterProfile: %v", err)
	}

	writes := 0
	for _, c := range *calls {
		if c.Method == http.MethodPost || c.Method == http.MethodPut {
			writes++
		}
	}
	if writes != 1 {
		t.Fatalf("expected exactly 1 write when override is off, got %d: %+v", writes, *calls)
	}
}

func TestCreateWebFilterProfile_OverrideOnSplitsIntoTwoWrites(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	form := wfForm(func(f *WebFilterProfileForm) {
		f.AllowOverride = true
		f.Override = WebFilterOverride{DurationMode: "predefined", DurationMins: 30}
	})
	if err := fc.CreateWebFilterProfile(form); err != nil {
		t.Fatalf("CreateWebFilterProfile: %v", err)
	}

	post := findCall(*calls, "POST", "/api/v2/cmdb/webfilter/profile")
	put := findCall(*calls, "PUT", "/api/v2/cmdb/webfilter/profile/wf1")
	if post == nil {
		t.Fatalf("expected a POST (the override-off create), got %+v", *calls)
	}
	if put == nil {
		t.Fatalf("expected a follow-up PUT (turning override on), got %+v", *calls)
	}

	// The first write (POST) must not carry the override flag — that is the whole point of
	// splitting it off.
	if ovrd, _ := post.Body["ovrd-perm"].(string); ovrd != "" {
		t.Errorf("the override-off create must not send ovrd-perm, got %q", ovrd)
	}
	// The second write (PUT) must carry it.
	if ovrd, _ := put.Body["ovrd-perm"].(string); ovrd != "fortiguard-wf-override" {
		t.Errorf("the follow-up PUT must enable ovrd-perm, got %q", ovrd)
	}

	// Both writes must agree on the duration — that agreement is exactly what makes the second
	// write (the one that matters, since it is the one with override on) acceptable to the device.
	postOverride, _ := post.Body["override"].(map[string]interface{})
	putOverride, _ := put.Body["override"].(map[string]interface{})
	if postOverride["ovrd-dur"] != putOverride["ovrd-dur"] {
		t.Errorf("the two writes disagree on ovrd-dur: %v vs %v", postOverride["ovrd-dur"], putOverride["ovrd-dur"])
	}
}

func TestUpdateWebFilterProfile_OverrideOffIsOneWrite(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.UpdateWebFilterProfile("wf1", wfForm(nil)); err != nil {
		t.Fatalf("UpdateWebFilterProfile: %v", err)
	}
	puts := 0
	for _, c := range *calls {
		if c.Method == http.MethodPut {
			puts++
		}
	}
	if puts != 1 {
		t.Fatalf("expected exactly 1 PUT when override is off, got %d: %+v", puts, *calls)
	}
}

func TestUpdateWebFilterProfile_OverrideOnSplitsIntoTwoWrites(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	form := wfForm(func(f *WebFilterProfileForm) {
		f.AllowOverride = true
		f.Override = WebFilterOverride{DurationMode: "predefined", DurationMins: 45}
	})
	if err := fc.UpdateWebFilterProfile("wf1", form); err != nil {
		t.Fatalf("UpdateWebFilterProfile: %v", err)
	}

	puts := 0
	var bodies []map[string]interface{}
	for _, c := range *calls {
		if c.Method == http.MethodPut {
			puts++
			bodies = append(bodies, c.Body)
		}
	}
	if puts != 2 {
		t.Fatalf("expected exactly 2 PUTs when override is being turned on, got %d: %+v", puts, *calls)
	}
	if ovrd, _ := bodies[0]["ovrd-perm"].(string); ovrd != "" {
		t.Errorf("the first PUT must not enable override, got %q", ovrd)
	}
	if ovrd, _ := bodies[1]["ovrd-perm"].(string); ovrd != "fortiguard-wf-override" {
		t.Errorf("the second PUT must enable override, got %q", ovrd)
	}
}
