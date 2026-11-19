package services

import (
	"encoding/json"
	"reflect"
	"testing"
)

// A profile read from the device, shown in the form and saved again must not drift. The fixture
// is trimmed from GET /api/v2/cmdb/firewall/ssl-ssh-profile on the lab FGT80E (the
// `deep-inspection` built-in).
const sslProfileFixture = `{
  "name": "deep-inspection",
  "comment": "Read-only deep inspection profile.",
  "server-cert-mode": "re-sign",
  "caname": "Fortinet_CA_SSL",
  "untrusted-caname": "Fortinet_CA_Untrusted",
  "allowlist": "disable",
  "block-blocklisted-certificates": "enable",
  "supported-alpn": "all",
  "ssl": { "inspect-all": "disable" },
  "https": {
    "ports": [443], "status": "deep-inspection", "proxy-after-tcp-handshake": "disable",
    "client-certificate": "bypass", "unsupported-ssl-version": "block",
    "unsupported-ssl-cipher": "allow", "unsupported-ssl-negotiation": "allow",
    "expired-server-cert": "block", "revoked-server-cert": "block",
    "untrusted-server-cert": "allow", "cert-validation-timeout": "allow",
    "cert-validation-failure": "block", "sni-server-cert-check": "enable",
    "cert-probe-failure": "block", "min-allowed-ssl-version": "tls-1.1"
  },
  "ssh": {
    "ports": [22], "status": "disable", "inspect-all": "disable",
    "proxy-after-tcp-handshake": "disable", "unsupported-version": "bypass",
    "ssh-tun-policy-check": "disable", "ssh-algorithm": "compatible"
  },
  "server-cert": [],
  "ssl-exempt": [
    {"id": 1, "type": "fortiguard-category", "fortiguard-category": 31,
     "address": "", "address6": "", "wildcard-fqdn": "", "regex": ""}
  ]
}`

func TestSSLSSHProfile_RoundTripsWithoutDrift(t *testing.T) {
	var dev fgSSLSSHProfile
	if err := json.Unmarshal([]byte(sslProfileFixture), &dev); err != nil {
		t.Fatalf("fixture did not decode: %v", err)
	}
	form := fgToSSLSSHProfileForm(dev)

	if form.Name != "deep-inspection" || form.ServerCertMode != "re-sign" {
		t.Errorf("scalars wrong: %+v", form)
	}
	if form.CACertificate != "Fortinet_CA_SSL" {
		t.Errorf("CA = %q", form.CACertificate)
	}
	if form.Allowlist || !form.BlockBlocklistedCertificates {
		t.Errorf("allowlist=%v blockBlocklisted=%v", form.Allowlist, form.BlockBlocklistedCertificates)
	}

	// All seven blocks must be present and in a stable order, or the form renders differently
	// each time it is opened.
	if len(form.Protocols) != len(SSLProtocolNames) {
		t.Fatalf("protocols = %d, want %d", len(form.Protocols), len(SSLProtocolNames))
	}
	// `ssl` leads the list: it is the catch-all block, and on a flow-mode device it is the only
	// row that carries certificate handling at all.
	if form.Protocols[0].Protocol != "ssl" {
		t.Errorf("protocol[0] = %q, want the ssl catch-all first", form.Protocols[0].Protocol)
	}
	for i, want := range SSLProtocolNames {
		if form.Protocols[i].Protocol != want {
			t.Errorf("protocol[%d] = %q, want %q", i, form.Protocols[i].Protocol, want)
		}
	}

	https := form.Protocols[1]
	if https.Status != "deep-inspection" || !reflect.DeepEqual(https.Ports, []int{443}) {
		t.Errorf("https block wrong: %+v", https)
	}
	if https.MinAllowedSSLVersion != "tls-1.1" || https.ExpiredServerCert != "block" {
		t.Errorf("https cert handling wrong: %+v", https)
	}

	if len(form.Exemptions) != 1 || form.Exemptions[0].FortiguardCategory != 31 {
		t.Errorf("exemptions = %+v", form.Exemptions)
	}

	// Back out to the wire.
	payload := sslSSHProfilePayload(form, true)
	httpsOut := payload["https"].(map[string]interface{})
	if httpsOut["status"] != "deep-inspection" {
		t.Errorf("https status went out as %#v", httpsOut["status"])
	}
	if !reflect.DeepEqual(httpsOut["ports"], []int{443}) {
		t.Errorf("https ports went out as %#v", httpsOut["ports"])
	}
}

// ssh is the odd block: no certificate handling at all, three settings none of the others have.
// Sending the certificate keys to it is rejected outright by the device.
func TestSSLProtocolPayload_SSHCarriesNoCertificateKeys(t *testing.T) {
	block := sslProtocolPayload(SSLProtocolOptions{
		Protocol: "ssh", Status: "deep-inspection", Ports: []int{22},
		SSHAlgorithm: "high-encryption", UnsupportedVersion: "block", SSHTunPolicyCheck: true,
		// These are set, and must be dropped:
		ExpiredServerCert: "block", MinAllowedSSLVersion: "tls-1.2", ClientCertificate: "inspect",
	}, nil)

	for _, forbidden := range []string{
		"expired-server-cert", "min-allowed-ssl-version", "client-certificate",
		"untrusted-server-cert", "sni-server-cert-check", "cert-probe-failure",
	} {
		if _, present := block[forbidden]; present {
			t.Errorf("ssh block carries %q — the device rejects certificate keys on ssh", forbidden)
		}
	}
	if block["ssh-algorithm"] != "high-encryption" || block["unsupported-version"] != "block" {
		t.Errorf("ssh-only fields missing or wrong: %#v", block)
	}
	if block["ssh-tun-policy-check"] != "enable" {
		t.Errorf("ssh-tun-policy-check = %#v", block["ssh-tun-policy-check"])
	}
}

// A protocol switched on with no ports would inspect nothing. FortiOS's own defaults are the
// right fallback, and they are not all the well-known ones — smtps is 465 and dot is 853 on this
// firmware, so a guess would silently miss.
func TestSSLProtocolPayload_FillsInDeviceDefaultPorts(t *testing.T) {
	for proto, want := range defaultSSLPorts {
		block := sslProtocolPayload(SSLProtocolOptions{Protocol: proto, Status: "deep-inspection"}, nil)
		if proto == "ssl" {
			// The catch-all matches whatever no other block claimed, so it carries no port list
			// and no `status` — its switch is `inspect-all`.
			if _, present := block["ports"]; present {
				t.Errorf("ssl catch-all carries a ports key: %#v", block["ports"])
			}
			if _, present := block["inspect-all"]; !present {
				t.Error("ssl catch-all is missing inspect-all, which is its only switch")
			}
			continue
		}
		if !reflect.DeepEqual(block["ports"], want) {
			t.Errorf("%s: ports = %#v, want %v", proto, block["ports"], want)
		}
	}
}

// ── The flow-mode trap ───────────────────────────────────────────────────────
//
// A flow-based FortiGate does not have most of this profile, and its REST API accepts the fields
// anyway: 200, "status": "success", "revision_changed": false, nothing stored. Verified live on
// the lab FGT80E, which runs gui-proxy-inspection: disable.
//
// So the payload must not contain them. These tests are the guard: they fail if someone adds a
// field to the builder without adding it to sslFlowFields, which is exactly how the silent
// discard would come back.

func TestSSLProtocolPayload_FlowModeSendsOnlyWhatTheDeviceHas(t *testing.T) {
	full := SSLProtocolOptions{
		Protocol: "https", Status: "deep-inspection", Ports: []int{443, 8443},
		UntrustedServerCert: "block", SNIServerCertCheck: "strict",
		MinAllowedSSLVersion: "tls-1.2", ClientCertificate: "inspect",
		ExpiredServerCert: "block", CertProbeFailure: "block",
	}

	block := sslProtocolPayload(full, sslFlowFields["https"])

	// What a flow device actually accepts under `config https` — read off the CLI with `get`.
	for _, want := range []string{
		"client-certificate", "unsupported-ssl-version", "unsupported-ssl-cipher",
		"unsupported-ssl-negotiation", "min-allowed-ssl-version",
	} {
		if _, present := block[want]; !present {
			t.Errorf("flow-mode https block is missing %q, which the device does have", want)
		}
	}
	// Everything else would be accepted with a 200 and thrown away.
	for _, forbidden := range []string{
		"ports", "status", "proxy-after-tcp-handshake", "untrusted-server-cert",
		"sni-server-cert-check", "expired-server-cert", "revoked-server-cert",
		"cert-validation-timeout", "cert-validation-failure", "cert-probe-failure",
	} {
		if _, present := block[forbidden]; present {
			t.Errorf("flow-mode https block carries %q — the device answers 200 and discards it, "+
				"so the user is told a setting was saved that was not", forbidden)
		}
	}
}

func TestSSLSSHProfilePayload_FlowModeDropsProxyOnlyProfileFields(t *testing.T) {
	form := SSLSSHProfileForm{
		Name: "x", ServerCertMode: "re-sign", CACertificate: "Fortinet_CA_SSL",
		Allowlist: true, SupportedALPN: "all", RPCOverHTTPS: true, MAPIOverHTTPS: true,
		LogSSLExemption: true, LogSSLAnomaly: true,
		Exemptions: []SSLExemptEntry{{Type: "wildcard-fqdn", WildcardFQDN: "gmail.com"}},
	}

	flow := sslSSHProfilePayload(form, false)
	for _, forbidden := range sslProxyOnlyProfileFields {
		if _, present := flow[forbidden]; present {
			t.Errorf("flow-mode payload carries proxy-only field %q", forbidden)
		}
	}
	// The half that DOES exist in flow mode must survive, or a flow device could never be
	// configured at all.
	for _, want := range []string{"name", "caname", "block-blocklisted-certificates", "ssl-anomaly-log"} {
		if _, present := flow[want]; !present {
			t.Errorf("flow-mode payload dropped %q, which every unit has", want)
		}
	}

	// On a proxy unit all of it goes out, including the exemption table.
	proxy := sslSSHProfilePayload(form, true)
	for _, want := range sslProxyOnlyProfileFields {
		if _, present := proxy[want]; !present {
			t.Errorf("proxy-mode payload is missing %q", want)
		}
	}
}

// Every key the builder can emit must be classified, or the guard above has a hole.
func TestSSLFlowFields_CoverEveryBlock(t *testing.T) {
	for _, name := range SSLProtocolNames {
		if _, ok := sslFlowFields[name]; !ok {
			t.Errorf("sslFlowFields has no entry for %q — flow mode would send it everything", name)
		}
	}
}

// ftps is the one block without proxy-after-tcp-handshake in the schema.
func TestSSLProtocolPayload_FTPSHasNoProxyAfterHandshake(t *testing.T) {
	block := sslProtocolPayload(SSLProtocolOptions{Protocol: "ftps", Status: "deep-inspection"}, nil)
	if _, present := block["proxy-after-tcp-handshake"]; present {
		t.Error("ftps block carries proxy-after-tcp-handshake, which its schema does not have")
	}
}

func TestSSLSSHProfilePayload_RenumbersExemptionIDs(t *testing.T) {
	form := SSLSSHProfileForm{
		Name: "x",
		Exemptions: []SSLExemptEntry{
			{Type: "address", Address: "a"},
			{Type: "address", Address: "b"},
			{Type: "regex", Regex: ".*"},
		},
	}
	rows := sslSSHProfilePayload(form, true)["ssl-exempt"].([]map[string]interface{})
	for i, r := range rows {
		if r["id"] != i+1 {
			t.Errorf("exemption %d has id %v, want %d", i, r["id"], i+1)
		}
	}
	// Only the slot matching the type should be filled — sending all five confuses the device.
	if _, hasRegex := rows[0]["regex"]; hasRegex {
		t.Error("an address exemption also carried a regex slot")
	}
}

// caname is required by the schema. An empty one used to mean a create failed on a field the
// user was never shown.
func TestSSLSSHProfilePayload_DefaultsTheCA(t *testing.T) {
	p := sslSSHProfilePayload(SSLSSHProfileForm{Name: "x"}, true)
	if p["caname"] != "Fortinet_CA_SSL" || p["untrusted-caname"] != "Fortinet_CA_Untrusted" {
		t.Errorf("CA defaults not applied: caname=%v untrusted=%v", p["caname"], p["untrusted-caname"])
	}
}

func TestValidateSSLSSHProfileForm(t *testing.T) {
	good := SSLSSHProfileForm{
		Name: "outbound-deep", ServerCertMode: "re-sign", CACertificate: "Fortinet_CA_SSL",
		Protocols: []SSLProtocolOptions{{Protocol: "https", Status: "deep-inspection", Ports: []int{443}}},
	}
	if err := ValidateSSLSSHProfileForm(good); err != nil {
		t.Fatalf("a reasonable profile was rejected: %v", err)
	}

	cases := []struct {
		name string
		form SSLSSHProfileForm
	}{
		{"no name", SSLSSHProfileForm{ServerCertMode: "re-sign"}},
		// The classic misconfiguration: deep inspection with nothing to re-sign with, so every
		// HTTPS site shows a certificate warning.
		{"deep inspection with no CA", SSLSSHProfileForm{
			Name: "x", ServerCertMode: "re-sign",
			Protocols: []SSLProtocolOptions{{Protocol: "https", Status: "deep-inspection", Ports: []int{443}}},
		}},
		{"protect-server with no certificate", SSLSSHProfileForm{
			Name: "x", ServerCertMode: "replace", CACertificate: "Fortinet_CA_SSL",
		}},
		{"bad server-cert mode", SSLSSHProfileForm{Name: "x", ServerCertMode: "sideways"}},
		{"ssh cannot do certificate-inspection", SSLSSHProfileForm{
			Name: "x", ServerCertMode: "re-sign", CACertificate: "c",
			Protocols: []SSLProtocolOptions{{Protocol: "ssh", Status: "certificate-inspection", Ports: []int{22}}},
		}},
		{"port out of range", SSLSSHProfileForm{
			Name: "x", ServerCertMode: "re-sign", CACertificate: "c",
			Protocols: []SSLProtocolOptions{{Protocol: "https", Status: "deep-inspection", Ports: []int{70000}}},
		}},
		{"invalid cert-handling value", SSLSSHProfileForm{
			Name: "x", ServerCertMode: "re-sign", CACertificate: "c",
			Protocols: []SSLProtocolOptions{{Protocol: "https", Status: "deep-inspection", Ports: []int{443}, ExpiredServerCert: "maybe"}},
		}},
		{"exemption with no value", SSLSSHProfileForm{
			Name: "x", ServerCertMode: "re-sign", CACertificate: "c",
			Protocols:  good.Protocols,
			Exemptions: []SSLExemptEntry{{Type: "address"}},
		}},
		{"exemption with unknown type", SSLSSHProfileForm{
			Name: "x", ServerCertMode: "re-sign", CACertificate: "c",
			Protocols:  good.Protocols,
			Exemptions: []SSLExemptEntry{{Type: "vibes"}},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateSSLSSHProfileForm(tc.form); err == nil {
				t.Error("accepted")
			}
		})
	}
}

// FortiOS refuses to modify its three shipped profiles. Saying so beats letting the user fill in
// a form and receive a numeric refusal.
func TestUpdateSSLSSHProfile_RefusesBuiltinsWithAReason(t *testing.T) {
	f := &FortiClient{}
	for _, name := range []string{"deep-inspection", "certificate-inspection", "no-inspection"} {
		err := f.UpdateSSLSSHProfile(name, SSLSSHProfileForm{Name: name})
		if err == nil {
			t.Errorf("%s: accepted an edit to a built-in profile", name)
		}
	}
	// custom-deep-inspection exists precisely so there is one that CAN be edited — it must not be
	// caught by the guard. (It gets past the check and fails on the nil transport instead.)
	if IsBuiltinSSLProfile("custom-deep-inspection") {
		t.Error("custom-deep-inspection was treated as a locked built-in")
	}
}
