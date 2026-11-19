package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var sslSshProfileTable = cmdbPath{path: "firewall/ssl-ssh-profile", noun: "ssl ssh profile"}

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var sslSSHProfileTable = cmdbPath{path: "firewall/ssl-ssh-profile", noun: "SSL/SSH profile"}

// SSL/SSH Inspection profile (firewall/ssl-ssh-profile) — form mapping and metadata.
//
// This page existed before as a LIST ONLY: pages/security-profiles/index.tsx set isReadOnly for
// the category and the controller answered 501 for get/create/update. That made the other five
// Security Profiles pages half-useful — AntiVirus, Web Filter, DNS Filter, Application Control
// and File Filter only see inside a TLS session if an inspection profile decrypts it first, and
// the profile that does the decrypting could only be built in FortiGate's own GUI.
//
// CMDB path /api/v2/cmdb/firewall/ssl-ssh-profile (mkey=name). Verified live against
// 10.0.99.201 (FortiGate 80E, FortiOS 7.2.10): schema pulled with `?action=schema&vdom=root`,
// object shape read back from the built-in `deep-inspection` profile.

// ── Built-ins ─────────────────────────────────────────────────────────────────

// builtinSSLProfiles are the profiles FortiOS ships and refuses to modify. Its own GUI shows
// them greyed with a padlock and only offers Clone.
//
// Listed here so the console can say WHY an edit is not offered, instead of letting the user fill
// in a form and receive a numeric refusal on save. The device stays the authority — nothing here
// blocks a write, it only drives what the list page renders — so a firmware that starts allowing
// one of these keeps working without a code change.
//
// `custom-deep-inspection` is deliberately NOT in the list: FortiOS ships it precisely so there
// is one deep-inspection profile that can be edited.
var builtinSSLProfiles = map[string]bool{
	"certificate-inspection": true,
	"deep-inspection":        true,
	"no-inspection":          true,
}

// IsBuiltinSSLProfile reports whether FortiOS treats this profile as read-only.
func IsBuiltinSSLProfile(name string) bool { return builtinSSLProfiles[strings.ToLower(name)] }

// ── Form ──────────────────────────────────────────────────────────────────────

// SSLProtocolOptions is one row of the profile's "Protocol Port Mapping" table.
//
// The seven protocol blocks share most of their fields but not all: `ssh` has no certificate
// handling at all and carries three settings none of the others do. Rather than seven near-copies
// of a struct, this is one struct where the SSH-only fields are documented as such and ignored
// for the rest — which is also how the device's own schema is shaped.
type SSLProtocolOptions struct {
	// Protocol is one of: https ftps imaps pop3s smtps dot ssh.
	Protocol string `json:"protocol"`
	// Status: disable | certificate-inspection | deep-inspection.
	// ssh and dot accept only disable | deep-inspection.
	Status string `json:"status"`
	Ports  []int  `json:"ports"`

	ProxyAfterTCPHandshake bool `json:"proxy_after_tcp_handshake"`

	// ── Certificate handling (every protocol except ssh) ──────────────────────
	ClientCertificate         string `json:"client_certificate"`          // bypass | inspect | block
	UnsupportedSSLVersion     string `json:"unsupported_ssl_version"`     // allow | block
	UnsupportedSSLCipher      string `json:"unsupported_ssl_cipher"`      // allow | block
	UnsupportedSSLNegotiation string `json:"unsupported_ssl_negotiation"` // allow | block
	ExpiredServerCert         string `json:"expired_server_cert"`         // allow | block | ignore
	RevokedServerCert         string `json:"revoked_server_cert"`         // allow | block | ignore
	UntrustedServerCert       string `json:"untrusted_server_cert"`       // allow | block | ignore
	CertValidationTimeout     string `json:"cert_validation_timeout"`     // allow | block | ignore
	CertValidationFailure     string `json:"cert_validation_failure"`     // allow | block | ignore
	SNIServerCertCheck        string `json:"sni_server_cert_check"`       // enable | strict | disable
	CertProbeFailure          string `json:"cert_probe_failure"`          // allow | block
	MinAllowedSSLVersion      string `json:"min_allowed_ssl_version"`     // ssl-3.0 … tls-1.3

	// ── SSH only ─────────────────────────────────────────────────────────────
	InspectAll         string `json:"inspect_all"`         // disable | deep-inspection
	UnsupportedVersion string `json:"unsupported_version"` // bypass | block
	SSHAlgorithm       string `json:"ssh_algorithm"`       // compatible | high-encryption
	SSHTunPolicyCheck  bool   `json:"ssh_tun_policy_check"`
}

// SSLExemptEntry is one row of "Exempt from SSL Inspection".
type SSLExemptEntry struct {
	// Type: fortiguard-category | address | address6 | wildcard-fqdn | regex.
	Type string `json:"type"`
	// Exactly one of these is meaningful, chosen by Type.
	FortiguardCategory int    `json:"fortiguard_category"`
	Address            string `json:"address"`
	Address6           string `json:"address6"`
	WildcardFQDN       string `json:"wildcard_fqdn"`
	Regex              string `json:"regex"`
}

// SSLSSHProfileForm mirrors the FortiOS "New SSL/SSH Inspection Profile" page.
type SSLSSHProfileForm struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`

	// ServerCertMode is the page's top radio, "Enable SSL inspection of":
	//   re-sign → Multiple Clients Connecting to Multiple Servers (outbound; the CA re-signs)
	//   replace → Protecting SSL Server (inbound; the server's own certificate is presented)
	ServerCertMode string `json:"server_cert_mode"`

	// CACertificate is the re-signing CA. Required by the schema, and the single setting that
	// decides whether browsers show a warning: it must be a CA the endpoints trust.
	CACertificate      string   `json:"ca_certificate"`
	UntrustedCACert    string   `json:"untrusted_ca_certificate"`
	ServerCertificates []string `json:"server_certificates"` // "replace" mode only

	Protocols []SSLProtocolOptions `json:"protocols"`

	// Allowlist is the GUI's "Exempt reputable websites" — FortiGuard's own list of sites known
	// to break under interception (banks, software updaters).
	Allowlist                    bool             `json:"allowlist"`
	BlockBlocklistedCertificates bool             `json:"block_blocklisted_certificates"`
	Exemptions                   []SSLExemptEntry `json:"exemptions"`

	SupportedALPN string `json:"supported_alpn"` // http1-1 | http2 | all | none
	RPCOverHTTPS  bool   `json:"rpc_over_https"`
	MAPIOverHTTPS bool   `json:"mapi_over_https"`

	// Logging.
	LogSSLExemption   bool `json:"log_ssl_exemption"`
	LogSSLAnomaly     bool `json:"log_ssl_anomaly"`
	LogSSLNegotiation bool `json:"log_ssl_negotiation"`
	LogSSLServerCert  bool `json:"log_ssl_server_cert"`
	LogSSLHandshake   bool `json:"log_ssl_handshake"`
}

// SSLProtocolNames is the fixed set of blocks, in the order the FortiOS page shows them.
//
// `ssl` is first and is not a protocol: it is the device's catch-all for TLS seen on a port no
// other block claims, and its `inspect-all` is what governs inspection when the unit runs
// flow-based (see sslProxyOnly below). Modelling it as a row rather than as one stray field is
// how the device itself is shaped, and on a flow-mode unit it is the only row that can carry
// certificate handling at all.
var SSLProtocolNames = []string{"ssl", "https", "ftps", "imaps", "pop3s", "smtps", "dot", "ssh"}

// sslCertProtocols are the blocks that carry certificate handling — everything but ssh.
func sslHasCertHandling(protocol string) bool { return protocol != "ssh" }

// ── Proxy vs flow inspection: what the device will actually accept ───────────
//
// ⚠️ This is the trap this file exists to close. A FortiGate running FLOW-based inspection
// (`system/settings` → `gui-proxy-inspection: disable`, which is the default and what the lab
// FGT80E runs) does not have most of the ssl-ssh-profile fields at all. The CLI is honest about
// it — `config https` then `get` lists five fields, and setting any other returns -61 — but the
// REST API is NOT:
//
//	PUT /api/v2/cmdb/firewall/ssl-ssh-profile/<name>
//	    {"https": {"ports": [443,8443], "untrusted-server-cert": "block", …}}
//	→ 200 {"status": "success", "revision_changed": false}   … and nothing was stored.
//
// Verified live. A form that sends these anyway reports a successful save while the firewall
// discards the input, which is worse than an error: the operator believes the profile blocks
// untrusted certificates and it does not. So the payload builder omits what the device cannot
// take, and the metadata tells the form which controls to grey out — the same treatment the
// AntiVirus form already gives FortiSandbox and outbreak prevention.

// sslProxyOnlyProfileFields are profile-level keys that exist only under proxy inspection.
var sslProxyOnlyProfileFields = []string{
	"allowlist", "ssl-exempt", "ssl-exemption-log", "server-cert-mode",
	"untrusted-caname", "supported-alpn", "rpc-over-https", "mapi-over-https",
}

// sslFlowFields lists, per block, exactly what a flow-mode device accepts. Anything absent here
// is dropped from the payload when the unit is flow-based. Read off the device with
// `config firewall ssl-ssh-profile / edit <p> / get` — not from documentation.
var sslFlowFields = map[string]map[string]bool{
	// The catch-all keeps its whole field set in flow mode; it is where inspection is configured.
	"ssl": {
		"inspect-all": true, "client-certificate": true,
		"unsupported-ssl-version": true, "unsupported-ssl-cipher": true,
		"unsupported-ssl-negotiation": true, "expired-server-cert": true,
		"revoked-server-cert": true, "untrusted-server-cert": true,
		"cert-validation-timeout": true, "cert-validation-failure": true,
		"sni-server-cert-check": true, "cert-probe-failure": true,
		"min-allowed-ssl-version": true,
	},
	"https": {
		"client-certificate": true, "unsupported-ssl-version": true,
		"unsupported-ssl-cipher": true, "unsupported-ssl-negotiation": true,
		"min-allowed-ssl-version": true,
	},
	"ftps": {
		"client-certificate": true, "unsupported-ssl-version": true,
		"unsupported-ssl-cipher": true, "unsupported-ssl-negotiation": true,
		"min-allowed-ssl-version": true,
	},
	// The three mail blocks lose min-allowed-ssl-version as well.
	"imaps": {
		"client-certificate": true, "unsupported-ssl-version": true,
		"unsupported-ssl-cipher": true, "unsupported-ssl-negotiation": true,
	},
	"pop3s": {
		"client-certificate": true, "unsupported-ssl-version": true,
		"unsupported-ssl-cipher": true, "unsupported-ssl-negotiation": true,
	},
	"smtps": {
		"client-certificate": true, "unsupported-ssl-version": true,
		"unsupported-ssl-cipher": true, "unsupported-ssl-negotiation": true,
	},
	"dot": {
		"status": true, "client-certificate": true,
		"unsupported-ssl-version": true, "unsupported-ssl-cipher": true,
		"unsupported-ssl-negotiation": true, "expired-server-cert": true,
		"revoked-server-cert": true, "untrusted-server-cert": true,
		"cert-validation-timeout": true, "cert-validation-failure": true,
	},
	// ssh is identical in both modes.
	"ssh": {
		"ports": true, "status": true, "inspect-all": true,
		"proxy-after-tcp-handshake": true, "unsupported-version": true,
		"ssh-tun-policy-check": true, "ssh-algorithm": true,
	},
}

// SSLProxyInspectionEnabled reports whether this unit exposes the proxy-only half of the profile.
//
// Best-effort: a device that cannot be read is assumed to be proxy-capable, so an unreadable
// firewall never causes fields to be silently stripped from a save.
func (f *FortiClient) SSLProxyInspectionEnabled() bool {
	resp, err := f.do("GET", "/api/v2/cmdb/system/settings?fields=gui-proxy-inspection", nil)
	if err != nil {
		return true
	}
	var settings struct {
		GUIProxyInspection string `json:"gui-proxy-inspection"`
	}
	// system/settings answers with a single object, but has been seen wrapped in an array.
	if json.Unmarshal(resp.Results, &settings) != nil {
		var arr []struct {
			GUIProxyInspection string `json:"gui-proxy-inspection"`
		}
		if json.Unmarshal(resp.Results, &arr) != nil || len(arr) == 0 {
			return true
		}
		settings.GUIProxyInspection = arr[0].GUIProxyInspection
	}
	if strings.TrimSpace(settings.GUIProxyInspection) == "" {
		return true
	}
	return settings.GUIProxyInspection == "enable"
}

// defaultSSLPorts are what FortiOS prefills when a protocol block is switched on. Taken from the
// built-in `deep-inspection` profile on the lab unit, not from the well-known-ports list: dot is
// 853 and smtps is 465 there, and guessing either wrong silently inspects nothing.
var defaultSSLPorts = map[string][]int{
	"ssl":   {}, // the catch-all has no port list — it is what matches everything else
	"https": {443}, "ftps": {990}, "imaps": {993}, "pop3s": {995},
	"smtps": {465}, "dot": {853}, "ssh": {22},
}

// ── Enum guards ───────────────────────────────────────────────────────────────

var (
	sslStatusValues        = map[string]bool{"disable": true, "certificate-inspection": true, "deep-inspection": true}
	sslDeepOnlyStatus      = map[string]bool{"disable": true, "deep-inspection": true}
	sslClientCertValues    = map[string]bool{"bypass": true, "inspect": true, "block": true}
	sslAllowBlockValues    = map[string]bool{"allow": true, "block": true}
	sslAllowBlockIgnore    = map[string]bool{"allow": true, "block": true, "ignore": true}
	sslSNIValues           = map[string]bool{"enable": true, "strict": true, "disable": true}
	sslMinVersionValues    = map[string]bool{"ssl-3.0": true, "tls-1.0": true, "tls-1.1": true, "tls-1.2": true, "tls-1.3": true}
	sslServerCertModeValue = map[string]bool{"re-sign": true, "replace": true}
	sslALPNValues          = map[string]bool{"http1-1": true, "http2": true, "all": true, "none": true}
	sslExemptTypeValues    = map[string]bool{"fortiguard-category": true, "address": true, "address6": true, "wildcard-fqdn": true, "regex": true}
	sshUnsupportedValues   = map[string]bool{"bypass": true, "block": true}
	sshAlgorithmValues     = map[string]bool{"compatible": true, "high-encryption": true}
)

// ValidateSSLSSHProfileForm rejects what the device would refuse, plus the two combinations that
// the device ACCEPTS but that produce a profile which does not do what the operator asked for.
func ValidateSSLSSHProfileForm(form SSLSSHProfileForm) error {
	if strings.TrimSpace(form.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if m := strings.TrimSpace(form.ServerCertMode); m != "" && !sslServerCertModeValue[m] {
		return fmt.Errorf("server_cert_mode must be re-sign or replace (got %q)", m)
	}
	if a := strings.TrimSpace(form.SupportedALPN); a != "" && !sslALPNValues[a] {
		return fmt.Errorf("supported_alpn must be http1-1, http2, all or none (got %q)", a)
	}

	// The CA is what makes re-signing work. FortiOS defaults it, so an empty value is filled in
	// rather than rejected (see sslSSHProfilePayload) — but a MODE of re-sign with the field
	// explicitly blanked is worth catching, because the profile would decrypt using a CA the
	// operator did not choose.
	if form.ServerCertMode == "replace" && len(form.ServerCertificates) == 0 {
		return fmt.Errorf("\"Protecting SSL Server\" needs at least one server certificate — " +
			"that certificate is what the firewall presents to clients")
	}

	deepSeen := false
	for _, p := range form.Protocols {
		name := strings.ToLower(strings.TrimSpace(p.Protocol))
		if name == "" {
			continue
		}
		if name == "ssl" {
			// The catch-all has no ports and its inspection setting is `inspect-all`, validated
			// with the same three values as a protocol's status.
			if v := strings.TrimSpace(p.InspectAll); v != "" && !sslStatusValues[v] {
				return fmt.Errorf("ssl: inspect-all must be disable, certificate-inspection or deep-inspection (got %q)", v)
			}
			if err := validateSSLCertOptions(name, p); err != nil {
				return err
			}
			if p.InspectAll == "deep-inspection" {
				deepSeen = true
			}
			continue
		}
		allowed := sslStatusValues
		if name == "ssh" || name == "dot" {
			allowed = sslDeepOnlyStatus
		}
		st := strings.TrimSpace(p.Status)
		if st != "" && !allowed[st] {
			return fmt.Errorf("%s: status %q is not valid for this protocol", name, st)
		}
		if st == "deep-inspection" {
			deepSeen = true
		}
		if st != "" && st != "disable" && len(p.Ports) == 0 && len(defaultSSLPorts[name]) == 0 {
			return fmt.Errorf("%s: inspection is on but no ports are listed — it would inspect nothing", name)
		}
		for _, port := range p.Ports {
			if port < 1 || port > 65535 {
				return fmt.Errorf("%s: port %d is out of range", name, port)
			}
		}
		if err := validateSSLCertOptions(name, p); err != nil {
			return err
		}
		if name == "ssh" {
			if v := strings.TrimSpace(p.UnsupportedVersion); v != "" && !sshUnsupportedValues[v] {
				return fmt.Errorf("ssh: unsupported_version must be bypass or block (got %q)", v)
			}
			if a := strings.TrimSpace(p.SSHAlgorithm); a != "" && !sshAlgorithmValues[a] {
				return fmt.Errorf("ssh: ssh_algorithm must be compatible or high-encryption (got %q)", a)
			}
		}
	}

	// Deep inspection with no CA chosen is the classic "why is every site showing a certificate
	// warning" configuration.
	if deepSeen && form.ServerCertMode != "replace" && strings.TrimSpace(form.CACertificate) == "" {
		return fmt.Errorf("deep inspection needs a CA certificate — without one the firewall " +
			"cannot re-sign, and every HTTPS site shows a certificate warning")
	}

	for i, e := range form.Exemptions {
		t := strings.TrimSpace(e.Type)
		if t == "" || !sslExemptTypeValues[t] {
			return fmt.Errorf("exemption %d: type must be fortiguard-category, address, address6, wildcard-fqdn or regex", i+1)
		}
		switch t {
		case "address":
			if strings.TrimSpace(e.Address) == "" {
				return fmt.Errorf("exemption %d: an address exemption needs an address object name", i+1)
			}
		case "address6":
			if strings.TrimSpace(e.Address6) == "" {
				return fmt.Errorf("exemption %d: an address6 exemption needs an IPv6 address object name", i+1)
			}
		case "wildcard-fqdn":
			if strings.TrimSpace(e.WildcardFQDN) == "" {
				return fmt.Errorf("exemption %d: a wildcard-FQDN exemption needs an FQDN object name", i+1)
			}
		case "regex":
			if strings.TrimSpace(e.Regex) == "" {
				return fmt.Errorf("exemption %d: a regex exemption needs a pattern", i+1)
			}
		case "fortiguard-category":
			if e.FortiguardCategory <= 0 {
				return fmt.Errorf("exemption %d: pick a FortiGuard category", i+1)
			}
		}
	}
	return nil
}

func validateSSLCertOptions(name string, p SSLProtocolOptions) error {
	if !sslHasCertHandling(name) {
		return nil
	}
	check := func(field, val string, allowed map[string]bool) error {
		if v := strings.TrimSpace(val); v != "" && !allowed[v] {
			return fmt.Errorf("%s: %s has invalid value %q", name, field, v)
		}
		return nil
	}
	for _, c := range []struct {
		field   string
		val     string
		allowed map[string]bool
	}{
		{"client_certificate", p.ClientCertificate, sslClientCertValues},
		{"unsupported_ssl_version", p.UnsupportedSSLVersion, sslAllowBlockValues},
		{"unsupported_ssl_cipher", p.UnsupportedSSLCipher, sslAllowBlockValues},
		{"unsupported_ssl_negotiation", p.UnsupportedSSLNegotiation, sslAllowBlockValues},
		{"cert_probe_failure", p.CertProbeFailure, sslAllowBlockValues},
		{"expired_server_cert", p.ExpiredServerCert, sslAllowBlockIgnore},
		{"revoked_server_cert", p.RevokedServerCert, sslAllowBlockIgnore},
		{"untrusted_server_cert", p.UntrustedServerCert, sslAllowBlockIgnore},
		{"cert_validation_timeout", p.CertValidationTimeout, sslAllowBlockIgnore},
		{"cert_validation_failure", p.CertValidationFailure, sslAllowBlockIgnore},
		{"sni_server_cert_check", p.SNIServerCertCheck, sslSNIValues},
		{"min_allowed_ssl_version", p.MinAllowedSSLVersion, sslMinVersionValues},
	} {
		if err := check(c.field, c.val, c.allowed); err != nil {
			return err
		}
	}
	return nil
}

// ── Device → form ─────────────────────────────────────────────────────────────

type fgSSLProtoBlock struct {
	Ports                     []int  `json:"ports"`
	Status                    string `json:"status"`
	InspectAll                string `json:"inspect-all"`
	ProxyAfterTCPHandshake    string `json:"proxy-after-tcp-handshake"`
	ClientCertificate         string `json:"client-certificate"`
	UnsupportedSSLVersion     string `json:"unsupported-ssl-version"`
	UnsupportedSSLCipher      string `json:"unsupported-ssl-cipher"`
	UnsupportedSSLNegotiation string `json:"unsupported-ssl-negotiation"`
	ExpiredServerCert         string `json:"expired-server-cert"`
	RevokedServerCert         string `json:"revoked-server-cert"`
	UntrustedServerCert       string `json:"untrusted-server-cert"`
	CertValidationTimeout     string `json:"cert-validation-timeout"`
	CertValidationFailure     string `json:"cert-validation-failure"`
	SNIServerCertCheck        string `json:"sni-server-cert-check"`
	CertProbeFailure          string `json:"cert-probe-failure"`
	MinAllowedSSLVersion      string `json:"min-allowed-ssl-version"`
	UnsupportedVersion        string `json:"unsupported-version"`
	SSHAlgorithm              string `json:"ssh-algorithm"`
	SSHTunPolicyCheck         string `json:"ssh-tun-policy-check"`
}

type fgSSLSSHProfile struct {
	Name            string          `json:"name"`
	Comment         string          `json:"comment"`
	ServerCertMode  string          `json:"server-cert-mode"`
	CAName          string          `json:"caname"`
	UntrustedCAName string          `json:"untrusted-caname"`
	Allowlist       string          `json:"allowlist"`
	BlockBlocklist  string          `json:"block-blocklisted-certificates"`
	SupportedALPN   string          `json:"supported-alpn"`
	RPCOverHTTPS    string          `json:"rpc-over-https"`
	MAPIOverHTTPS   string          `json:"mapi-over-https"`
	ExemptionLog    string          `json:"ssl-exemption-log"`
	AnomalyLog      string          `json:"ssl-anomaly-log"`
	NegotiationLog  string          `json:"ssl-negotiation-log"`
	ServerCertLog   string          `json:"ssl-server-cert-log"`
	HandshakeLog    string          `json:"ssl-handshake-log"`
	SSL             fgSSLProtoBlock `json:"ssl"`
	HTTPS           fgSSLProtoBlock `json:"https"`
	FTPS            fgSSLProtoBlock `json:"ftps"`
	IMAPS           fgSSLProtoBlock `json:"imaps"`
	POP3S           fgSSLProtoBlock `json:"pop3s"`
	SMTPS           fgSSLProtoBlock `json:"smtps"`
	DoT             fgSSLProtoBlock `json:"dot"`
	SSH             fgSSLProtoBlock `json:"ssh"`
	ServerCert      []struct {
		Name string `json:"name"`
	} `json:"server-cert"`
	SSLExempt []struct {
		Type               string `json:"type"`
		FortiguardCategory int    `json:"fortiguard-category"`
		Address            string `json:"address"`
		Address6           string `json:"address6"`
		WildcardFQDN       string `json:"wildcard-fqdn"`
		Regex              string `json:"regex"`
	} `json:"ssl-exempt"`
}

func fgBlockToProtocol(name string, b fgSSLProtoBlock) SSLProtocolOptions {
	ports := b.Ports
	if ports == nil {
		ports = []int{}
	}
	return SSLProtocolOptions{
		Protocol:                  name,
		Status:                    orDefault(b.Status, "disable"),
		Ports:                     ports,
		ProxyAfterTCPHandshake:    b.ProxyAfterTCPHandshake == "enable",
		ClientCertificate:         orDefault(b.ClientCertificate, "bypass"),
		UnsupportedSSLVersion:     orDefault(b.UnsupportedSSLVersion, "block"),
		UnsupportedSSLCipher:      orDefault(b.UnsupportedSSLCipher, "allow"),
		UnsupportedSSLNegotiation: orDefault(b.UnsupportedSSLNegotiation, "allow"),
		ExpiredServerCert:         orDefault(b.ExpiredServerCert, "block"),
		RevokedServerCert:         orDefault(b.RevokedServerCert, "block"),
		UntrustedServerCert:       orDefault(b.UntrustedServerCert, "allow"),
		CertValidationTimeout:     orDefault(b.CertValidationTimeout, "allow"),
		CertValidationFailure:     orDefault(b.CertValidationFailure, "block"),
		SNIServerCertCheck:        orDefault(b.SNIServerCertCheck, "enable"),
		CertProbeFailure:          orDefault(b.CertProbeFailure, "block"),
		MinAllowedSSLVersion:      orDefault(b.MinAllowedSSLVersion, "tls-1.1"),
		InspectAll:                orDefault(b.InspectAll, "disable"),
		UnsupportedVersion:        orDefault(b.UnsupportedVersion, "bypass"),
		SSHAlgorithm:              orDefault(b.SSHAlgorithm, "compatible"),
		SSHTunPolicyCheck:         b.SSHTunPolicyCheck == "enable",
	}
}

func fgToSSLSSHProfileForm(p fgSSLSSHProfile) SSLSSHProfileForm {
	form := SSLSSHProfileForm{
		Name:            p.Name,
		Comment:         p.Comment,
		ServerCertMode:  orDefault(p.ServerCertMode, "re-sign"),
		CACertificate:   p.CAName,
		UntrustedCACert: p.UntrustedCAName,

		Allowlist:                    p.Allowlist == "enable",
		BlockBlocklistedCertificates: p.BlockBlocklist == "enable",
		SupportedALPN:                orDefault(p.SupportedALPN, "all"),
		RPCOverHTTPS:                 p.RPCOverHTTPS == "enable",
		MAPIOverHTTPS:                p.MAPIOverHTTPS == "enable",

		LogSSLExemption:   p.ExemptionLog == "enable",
		LogSSLAnomaly:     p.AnomalyLog == "enable",
		LogSSLNegotiation: p.NegotiationLog == "enable",
		LogSSLServerCert:  p.ServerCertLog == "enable",
		LogSSLHandshake:   p.HandshakeLog == "enable",

		ServerCertificates: []string{},
		Exemptions:         []SSLExemptEntry{},
	}

	blocks := map[string]fgSSLProtoBlock{
		"ssl":   p.SSL,
		"https": p.HTTPS, "ftps": p.FTPS, "imaps": p.IMAPS, "pop3s": p.POP3S,
		"smtps": p.SMTPS, "dot": p.DoT, "ssh": p.SSH,
	}
	// Ordered by SSLProtocolNames rather than by map iteration so the form renders the same way
	// every time it is opened.
	for _, name := range SSLProtocolNames {
		form.Protocols = append(form.Protocols, fgBlockToProtocol(name, blocks[name]))
	}

	for _, sc := range p.ServerCert {
		if strings.TrimSpace(sc.Name) != "" {
			form.ServerCertificates = append(form.ServerCertificates, sc.Name)
		}
	}
	for _, e := range p.SSLExempt {
		form.Exemptions = append(form.Exemptions, SSLExemptEntry{
			Type:               e.Type,
			FortiguardCategory: e.FortiguardCategory,
			Address:            e.Address,
			Address6:           e.Address6,
			WildcardFQDN:       e.WildcardFQDN,
			Regex:              e.Regex,
		})
	}
	return form
}

// ── Form → device ─────────────────────────────────────────────────────────────

// sslProtocolPayload builds one block, dropping any key this device will not accept.
//
// `allowed` is nil on a proxy-capable unit, meaning "send everything"; on a flow-mode unit it is
// that block's entry from sslFlowFields, and anything outside it is left out rather than sent and
// silently discarded (see the note on sslProxyOnlyProfileFields).
func sslProtocolPayload(p SSLProtocolOptions, allowed map[string]bool) map[string]interface{} {
	name := strings.ToLower(strings.TrimSpace(p.Protocol))
	ports := p.Ports
	if len(ports) == 0 {
		ports = defaultSSLPorts[name]
	}
	// `ports` must go out as a real array even when empty, or the device keeps whatever was
	// there. An explicit nil marshals to JSON null, which FortiOS ignores.
	if ports == nil {
		ports = []int{}
	}

	block := map[string]interface{}{}
	// keep records a key only when the device has it.
	keep := func(k string, v interface{}) {
		if allowed == nil || allowed[k] {
			block[k] = v
		}
	}

	if name == "ssl" {
		// The catch-all: no ports, and `inspect-all` in place of `status`.
		keep("inspect-all", orDefault(p.InspectAll, "disable"))
	} else {
		keep("status", orDefault(p.Status, "disable"))
		keep("ports", ports)
	}
	keep("proxy-after-tcp-handshake", boolToEnable(p.ProxyAfterTCPHandshake))

	if name == "ssh" {
		keep("inspect-all", orDefault(p.InspectAll, "disable"))
		keep("unsupported-version", orDefault(p.UnsupportedVersion, "bypass"))
		keep("ssh-algorithm", orDefault(p.SSHAlgorithm, "compatible"))
		keep("ssh-tun-policy-check", boolToEnable(p.SSHTunPolicyCheck))
		// ssh has no ports-free "inspect everything else" of its own beyond inspect-all above,
		// and none of the certificate keys — sending them is rejected outright.
		return block
	}

	keep("client-certificate", orDefault(p.ClientCertificate, "bypass"))
	keep("unsupported-ssl-version", orDefault(p.UnsupportedSSLVersion, "block"))
	keep("unsupported-ssl-cipher", orDefault(p.UnsupportedSSLCipher, "allow"))
	keep("unsupported-ssl-negotiation", orDefault(p.UnsupportedSSLNegotiation, "allow"))
	keep("expired-server-cert", orDefault(p.ExpiredServerCert, "block"))
	keep("revoked-server-cert", orDefault(p.RevokedServerCert, "block"))
	keep("untrusted-server-cert", orDefault(p.UntrustedServerCert, "allow"))
	keep("cert-validation-timeout", orDefault(p.CertValidationTimeout, "allow"))
	keep("cert-validation-failure", orDefault(p.CertValidationFailure, "block"))
	keep("sni-server-cert-check", orDefault(p.SNIServerCertCheck, "enable"))
	keep("min-allowed-ssl-version", orDefault(p.MinAllowedSSLVersion, "tls-1.1"))

	// `dot` has no cert-probe-failure in the schema; the rest do.
	if name != "dot" {
		keep("cert-probe-failure", orDefault(p.CertProbeFailure, "block"))
	}
	// `ftps` is the one block without proxy-after-tcp-handshake.
	if name == "ftps" {
		delete(block, "proxy-after-tcp-handshake")
	}
	return block
}

// sslSSHProfilePayload builds the whole object. proxyInspection=false strips every key the
// device does not have, so a save never claims to have set something the firewall threw away.
func sslSSHProfilePayload(form SSLSSHProfileForm, proxyInspection bool) map[string]interface{} {
	ca := strings.TrimSpace(form.CACertificate)
	if ca == "" {
		// The schema marks caname required and defaults it. Filling it in here rather than
		// letting an empty string go out keeps a create from failing on a field the user was
		// never shown, and matches what the device would have chosen anyway.
		ca = "Fortinet_CA_SSL"
	}
	untrusted := strings.TrimSpace(form.UntrustedCACert)
	if untrusted == "" {
		untrusted = "Fortinet_CA_Untrusted"
	}

	payload := map[string]interface{}{
		"name":                           form.Name,
		"comment":                        form.Comment,
		"caname":                         ca,
		"block-blocklisted-certificates": boolToEnable(form.BlockBlocklistedCertificates),
		"ssl-anomaly-log":                boolToEnable(form.LogSSLAnomaly),
		"ssl-negotiation-log":            boolToEnable(form.LogSSLNegotiation),
		"ssl-server-cert-log":            boolToEnable(form.LogSSLServerCert),
		"ssl-handshake-log":              boolToEnable(form.LogSSLHandshake),
	}
	if proxyInspection {
		payload["server-cert-mode"] = orDefault(form.ServerCertMode, "re-sign")
		payload["untrusted-caname"] = untrusted
		payload["allowlist"] = boolToEnable(form.Allowlist)
		payload["supported-alpn"] = orDefault(form.SupportedALPN, "all")
		payload["rpc-over-https"] = boolToEnable(form.RPCOverHTTPS)
		payload["mapi-over-https"] = boolToEnable(form.MAPIOverHTTPS)
		payload["ssl-exemption-log"] = boolToEnable(form.LogSSLExemption)
	}

	sent := map[string]bool{}
	for _, p := range form.Protocols {
		name := strings.ToLower(strings.TrimSpace(p.Protocol))
		if name == "" || sent[name] {
			continue
		}
		if _, known := defaultSSLPorts[name]; !known {
			continue // ignore anything the device does not have a block for
		}
		sent[name] = true
		var allowed map[string]bool
		if !proxyInspection {
			allowed = sslFlowFields[name]
		}
		payload[name] = sslProtocolPayload(p, allowed)
	}

	certs := make([]map[string]interface{}, 0, len(form.ServerCertificates))
	for _, c := range form.ServerCertificates {
		if c = strings.TrimSpace(c); c != "" {
			certs = append(certs, map[string]interface{}{"name": c})
		}
	}
	payload["server-cert"] = certs

	// ssl-exempt is one of the proxy-only tables — a flow-mode device has no such list, and
	// sending one is accepted and dropped.
	if !proxyInspection {
		return payload
	}

	// ssl-exempt ids are renumbered from 1 on every write, for the same reason IPS entry ids are:
	// the form reorders and deletes freely, and reusing ids read earlier collides.
	exempts := make([]map[string]interface{}, 0, len(form.Exemptions))
	for i, e := range form.Exemptions {
		row := map[string]interface{}{"id": i + 1, "type": e.Type}
		switch e.Type {
		case "fortiguard-category":
			row["fortiguard-category"] = e.FortiguardCategory
		case "address":
			row["address"] = e.Address
		case "address6":
			row["address6"] = e.Address6
		case "wildcard-fqdn":
			row["wildcard-fqdn"] = e.WildcardFQDN
		case "regex":
			row["regex"] = e.Regex
		}
		exempts = append(exempts, row)
	}
	payload["ssl-exempt"] = exempts

	return payload
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

const sslSSHProfilePath = "/api/v2/cmdb/firewall/ssl-ssh-profile"

// GetSSLSSHProfile reads one profile and shapes it for the edit form.
func (f *FortiClient) GetSSLSSHProfile(name string) (SSLSSHProfileForm, error) {
	var form SSLSSHProfileForm
	resp, err := f.do("GET", sslSSHProfilePath+"/"+url.PathEscape(name), nil)
	if err != nil {
		return form, err
	}
	var items []fgSSLSSHProfile
	if err := json.Unmarshal(resp.Results, &items); err != nil {
		return form, fmt.Errorf("failed to parse SSL/SSH profile: %w", err)
	}
	if len(items) == 0 {
		return form, fmt.Errorf("SSL/SSH inspection profile %q not found", name)
	}
	return fgToSSLSSHProfileForm(items[0]), nil
}

// CreateSSLSSHProfile adds a profile.
func (f *FortiClient) CreateSSLSSHProfile(form SSLSSHProfileForm) error {
	err := sslSshProfileTable.Create(f, sslSSHProfilePayload(form, f.SSLProxyInspectionEnabled()))
	if err == nil {
		return nil
	}
	if IsDuplicateObjectError(err) {
		return fmt.Errorf("an SSL/SSH inspection profile named %q already exists on this device", form.Name)
	}
	// Found live: FortiOS can answer a validation failure (e.g. -651 "Must set at least one port
	// or enable ssl inspect-all") while having created the object anyway, with none of the
	// settings that were requested — the device's own template defaults instead. A caller told
	// "create failed" then has no reason to expect a retry under the same name to fail AGAIN with
	// "already exists", for an object it does not know exists. Check for exactly that, and clean
	// it up before handing back the original error, so a failed create really means nothing was
	// left on the device.
	f.deleteOrphanedSSLSSHProfile(form.Name)
	return err
}

// deleteOrphanedSSLSSHProfile removes form.Name if (and only if) CreateSSLSSHProfile's POST left
// it behind despite reporting failure. Best-effort: this runs after an error already happened, so
// a failure here is logged, never returned — the caller's original error is what matters.
func (f *FortiClient) deleteOrphanedSSLSSHProfile(name string) {
	resp, getErr := f.do("GET", sslSSHProfilePath+"/"+url.PathEscape(name), nil)
	if getErr != nil {
		return
	}
	var items []fgSSLSSHProfile
	if json.Unmarshal(resp.Results, &items) != nil || len(items) == 0 {
		return // the device really did reject the create — nothing to clean up
	}
	if delErr := sslSSHProfileTable.Delete(f, name); delErr != nil {
		log.Printf("[fortigate] left-over SSL/SSH profile %q from a failed create could not be removed: %v", name, delErr)
	}
}

// UpdateSSLSSHProfile rewrites a profile in place.
//
// A built-in is refused with the reason rather than the device's numeric code — see
// builtinSSLProfiles.
func (f *FortiClient) UpdateSSLSSHProfile(name string, form SSLSSHProfileForm) error {
	if IsBuiltinSSLProfile(name) {
		return fmt.Errorf("%q is a built-in FortiOS profile and cannot be modified — "+
			"clone it under a new name instead", name)
	}
	payload := sslSSHProfilePayload(form, f.SSLProxyInspectionEnabled())
	payload["name"] = name
	err := sslSshProfileTable.Update(f, name, payload)
	return err
}

// ── Metadata ──────────────────────────────────────────────────────────────────

// SSLSSHMetadata is what the SSL/SSH form's pickers need.
type SSLSSHMetadata struct {
	// CACertificates are local certificates with a private key — the re-signing CA picker.
	CACertificates []string `json:"ca_certificates"`
	// ServerCertificates is the same list, used by "Protecting SSL Server".
	ServerCertificates []string `json:"server_certificates"`
	// Addresses / WildcardFQDNs back the exemption drawer.
	Addresses    []string `json:"addresses"`
	WildcardFQDN []string `json:"wildcard_fqdns"`
	// Categories is the FortiGuard taxonomy for a category exemption, reusing the Web Filter one.
	Categories []FGWebFilterCategory `json:"categories"`
	Protocols  []string              `json:"protocols"`
	// DefaultPorts lets the form prefill a protocol block the way FortiOS does.
	DefaultPorts map[string][]int `json:"default_ports"`
	// BuiltinProfiles are the names the list page should show as read-only.
	BuiltinProfiles []string `json:"builtin_profiles"`

	// ProxyInspection is false on a flow-based unit, where most of this profile does not exist.
	// The form greys the controls the device would discard — see sslProxyOnlyProfileFields.
	ProxyInspection bool `json:"proxy_inspection"`
	// FlowFields tells the form exactly which keys survive per block when ProxyInspection is
	// false, so the greying rule lives on the device's answer rather than in a second copy of
	// this table in TypeScript.
	FlowFields map[string][]string `json:"flow_fields"`
	// ProxyOnlyProfileFields are the profile-level controls to grey out in flow mode.
	ProxyOnlyProfileFields []string `json:"proxy_only_profile_fields"`
}

// GetSSLSSHMetadata gathers the pickers. Best-effort per section, like the other metadata
// readers: a device that cannot answer one query still returns a usable form.
func (f *FortiClient) GetSSLSSHMetadata() SSLSSHMetadata {
	flow := make(map[string][]string, len(sslFlowFields))
	for block, fields := range sslFlowFields {
		keys := make([]string, 0, len(fields))
		for k := range fields {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		flow[block] = keys
	}

	meta := SSLSSHMetadata{
		Protocols:              SSLProtocolNames,
		DefaultPorts:           defaultSSLPorts,
		BuiltinProfiles:        []string{"certificate-inspection", "deep-inspection", "no-inspection"},
		CACertificates:         []string{},
		Addresses:              []string{},
		WildcardFQDN:           []string{},
		Categories:             []FGWebFilterCategory{},
		ProxyInspection:        f.SSLProxyInspectionEnabled(),
		FlowFields:             flow,
		ProxyOnlyProfileFields: sslProxyOnlyProfileFields,
	}

	// Local certificates carry the private key needed to re-sign; the CA bundle does not.
	for _, r := range f.certRows("/api/v2/cmdb/vpn.certificate/local?fields=name") {
		if r.Name != "" {
			meta.CACertificates = append(meta.CACertificates, r.Name)
		}
	}
	meta.ServerCertificates = meta.CACertificates

	if resp, err := f.do("GET", "/api/v2/cmdb/firewall/address?fields=name,type", nil); err == nil {
		var rows []struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}
		if json.Unmarshal(resp.Results, &rows) == nil {
			for _, r := range rows {
				if r.Name == "" {
					continue
				}
				// The exemption's `wildcard-fqdn` slot only accepts FQDN-typed objects; the
				// `address` slot takes the rest. Splitting them here means the form's two
				// pickers cannot offer an object the device will reject with -3.
				if r.Type == "fqdn" {
					meta.WildcardFQDN = append(meta.WildcardFQDN, r.Name)
				} else {
					meta.Addresses = append(meta.Addresses, r.Name)
				}
			}
		}
	}

	// The category list is the same FortiGuard taxonomy the Web Filter form renders.
	meta.Categories = f.fortiguardCategories()

	return meta
}
