package networkdevice

import "testing"

// validateBulkRow is the rule a batch import needs that a single create never could: catching two
// rows that would collide with EACH OTHER, not just with what is already in the database.

func row(name, vendor, mgmtIP string) bulkDeviceInput {
	return bulkDeviceInput{Name: name, Vendor: vendor, MgmtIP: mgmtIP}
}

func TestValidateBulkRow_RequiresNameVendorAndMgmtIP(t *testing.T) {
	empty := map[string]bool{}
	cases := []struct {
		row  bulkDeviceInput
		want string
	}{
		{row("", "fortinet", "10.0.1.1"), "name is required"},
		{row("Branch-1", "", "10.0.1.1"), "vendor is required"},
		{row("Branch-1", "fortinet", ""), "mgmt_ip is required"},
	}
	for _, c := range cases {
		if got := validateBulkRow(c.row, empty, empty, empty, empty); got != c.want {
			t.Errorf("validateBulkRow(%+v) = %q, want %q", c.row, got, c.want)
		}
	}
}

func TestValidateBulkRow_AcceptsAValidRowWithNothingToConflictWith(t *testing.T) {
	empty := map[string]bool{}
	if got := validateBulkRow(row("Branch-1", "fortinet", "10.0.1.1"), empty, empty, empty, empty); got != "" {
		t.Errorf("a valid, non-conflicting row was refused: %q", got)
	}
}

func TestValidateBulkRow_CatchesADuplicateNameWithinTheSameBatch(t *testing.T) {
	seenNames := map[string]bool{"branch-1": true} // lower-cased, as the handler stores it
	empty := map[string]bool{}
	got := validateBulkRow(row("Branch-1", "fortinet", "10.0.2.1"), seenNames, empty, empty, empty)
	if got == "" {
		t.Error("a name repeated later in the same import was accepted")
	}
}

func TestValidateBulkRow_NameMatchIsCaseInsensitive(t *testing.T) {
	seenNames := map[string]bool{"branch-1": true}
	empty := map[string]bool{}
	got := validateBulkRow(row("BRANCH-1", "fortinet", "10.0.2.1"), seenNames, empty, empty, empty)
	if got == "" {
		t.Error("a name differing only in case was accepted as distinct")
	}
}

func TestValidateBulkRow_CatchesADuplicateMgmtIPWithinTheSameBatch(t *testing.T) {
	seenIPs := map[string]bool{"10.0.1.1": true}
	empty := map[string]bool{}
	got := validateBulkRow(row("Branch-2", "fortinet", "10.0.1.1"), empty, seenIPs, empty, empty)
	if got == "" {
		t.Error("an mgmt_ip repeated later in the same import was accepted")
	}
}

func TestValidateBulkRow_CatchesANameAlreadyInTheDatabase(t *testing.T) {
	empty := map[string]bool{}
	dbNames := map[string]bool{"fortigate-80e": true}
	got := validateBulkRow(row("FortiGate-80E", "fortinet", "10.0.9.9"), empty, empty, dbNames, empty)
	if got == "" {
		t.Error("a name already in the database was accepted")
	}
}

func TestValidateBulkRow_CatchesAnMgmtIPAlreadyInTheDatabase(t *testing.T) {
	empty := map[string]bool{}
	dbIPs := map[string]bool{"10.0.99.201": true}
	got := validateBulkRow(row("New-Branch", "fortinet", "10.0.99.201"), empty, empty, empty, dbIPs)
	if got == "" {
		t.Error("an mgmt_ip already in the database was accepted")
	}
}
