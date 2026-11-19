package platform

import (
	"encoding/json"
	"strings"
	"testing"
)

// The regression guard for the fix in jobcredential.go.
//
// Both of these structs are marshalled straight into Redis, which this project runs with
// --appendonly yes. For as long as they carried `Password`, every backup and every config push
// appended a firewall administrator's password, in clear, to a file on disk that nothing rewrites.
// Adding the field back would not fail anything else: the worker would read it, the job would
// work, and nobody would notice until someone read the AOF.
func TestQueuePayloadsCarryNoCredential(t *testing.T) {
	cases := []struct {
		name string
		v    any
	}{
		{"BackupJobMessage", BackupJobMessage{
			JobID: 1, DeviceID: 2, Name: "lab-80e", Host: "10.10.20.90", Port: 22,
			Platform: "fortinet", CredentialToken: "tok", Type: "backup",
		}},
		{"ConfigDeviceTarget", ConfigDeviceTarget{
			ResultID: 3, DeviceID: 2, Name: "lab-80e", Host: "10.10.20.90", Port: 22,
			Platform: "fortinet", CredentialToken: "tok",
		}},
		{"ConfigJobMessage", ConfigJobMessage{
			DeployID: 4, Type: "config", Commands: []string{"show system status"},
			Targets: []ConfigDeviceTarget{{ResultID: 3, DeviceID: 2, CredentialToken: "tok"}},
		}},
	}

	banned := []string{"password", "passwd", "secret", "username", "user_name", "login"}

	for _, c := range cases {
		data, err := json.Marshal(c.v)
		if err != nil {
			t.Fatalf("%s: marshal: %v", c.name, err)
		}
		var fields map[string]any
		if err := json.Unmarshal(data, &fields); err != nil {
			// ConfigJobMessage nests; the top-level check below still applies to it.
			t.Fatalf("%s: unmarshal: %v", c.name, err)
		}
		lowered := strings.ToLower(string(data))
		for _, b := range banned {
			if strings.Contains(lowered, `"`+b+`"`) {
				t.Errorf("%s serialises a %q field — this payload is LPUSHed into a Redis that "+
					"appends every message to disk permanently. The credential belongs behind a "+
					"token (services/jobcredential.go), not in the queue.", c.name, b)
			}
		}
	}
}
