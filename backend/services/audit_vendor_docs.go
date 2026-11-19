package services

// ── Where the vendor documents the command ───────────────────────────────────
//
// The schema check next door proves a command is WELL-FORMED for this device. It cannot prove the
// command is the one Fortinet would tell you to run — the device will happily confirm that
// `logtraffic` exists and accepts `disable` too. So the second half of "says who?" is the vendor's
// own documentation, linked per CMDB table.
//
// LINKED, NEVER QUOTED. Fortinet's documentation is Fortinet's copyright, exactly as ISO/IEC's is
// ISO/IEC's, and the rule this repository applies to one it applies to the other: cite by name and
// URL, reproduce nothing. A reader who wants the wording follows the link.
//
// THE URLS ARE NOT GUESSED. Every entry below was taken from Fortinet's own CLI Reference index for
// FortiOS 7.2.10 and then fetched, and each page confirmed to actually document an attribute this
// console's fixes write:
//
//	config firewall policy          logtraffic
//	config firewall address         subnet
//	config firewall service custom  protocol
//	config system interface         allowaccess
//	config system admin             trusthost1
//	config system global            admintimeout
//	config system ntp               ntpsync
//	config log setting              fwpolicy-implicit-log
//	config log syslogd setting      server
//
// That check is a script's worth of work and is worth repeating when the pinned release moves —
// docs.fortinet.com answers 200 for a URL that does not exist, so a status code proves nothing and
// only the page content does.
//
// WHY IT IS PINNED TO A RELEASE. A CLI reference is per firmware. Linking "the latest" would send a
// reader running 7.2.10 to a page describing a build they are not on, which is the same class of
// mistake as citing a control number from the wrong edition of a standard. When the fleet moves,
// this table moves with it — deliberately one edit, in one place.

// docsFortiOSRelease is the FortiOS release these links describe. It is stated on screen beside
// them: a reader on a different build needs to know that before they act on the page.
const docsFortiOSRelease = "7.2.10"

const docsFortiOSBase = "https://docs.fortinet.com/document/fortigate/" + docsFortiOSRelease + "/cli-reference/"

// VendorDoc is the manufacturer's page for one CMDB table.
type VendorDoc struct {
	// Path is the CMDB path, matching FixTarget.Path.
	Path string `json:"path"`
	// Command is how the CLI reference names the section ("config firewall policy").
	Command   string `json:"command"`
	Title     string `json:"title"`
	Publisher string `json:"publisher"`
	Release   string `json:"release"`
	URL       string `json:"url"`
}

// vendorDocs maps every CMDB path this console's fixes touch to Fortinet's page for it.
//
// A path missing from here produces no link rather than a guessed one — the UI shows the schema
// verdict alone, which is still more than the page had before.
var vendorDocs = map[string]VendorDoc{
	cmdbPolicy:    {Command: "config firewall policy", URL: docsFortiOSBase + "333889629/config-firewall-policy"},
	cmdbAddress:   {Command: "config firewall address", URL: docsFortiOSBase + "306021697/config-firewall-address"},
	cmdbService:   {Command: "config firewall service custom", URL: docsFortiOSBase + "198499981/config-firewall-service-custom"},
	cmdbInterface: {Command: "config system interface", URL: docsFortiOSBase + "317104469/config-system-interface"},
	cmdbAdmin:     {Command: "config system admin", URL: docsFortiOSBase + "390485493/config-system-admin"},
	cmdbGlobal:    {Command: "config system global", URL: docsFortiOSBase + "339914554/config-system-global"},
	cmdbNTP:       {Command: "config system ntp", URL: docsFortiOSBase + "105110478/config-system-ntp"},
	cmdbLogSet:    {Command: "config log setting", URL: docsFortiOSBase + "196223761/config-log-setting"},
	cmdbSyslog:    {Command: "config log syslogd setting", URL: docsFortiOSBase + "141516630/config-log-syslogd-setting"},
}

// VendorDocsFor returns the manufacturer's pages for the tables a fix writes, deduplicated and in
// the order the targets first mention them.
func VendorDocsFor(targets []FixTarget) []VendorDoc {
	var out []VendorDoc
	seen := map[string]bool{}
	for _, t := range targets {
		if seen[t.Path] {
			continue
		}
		seen[t.Path] = true
		doc, ok := vendorDocs[t.Path]
		if !ok {
			continue
		}
		doc.Path = t.Path
		doc.Title = "FortiOS CLI Reference — " + doc.Command
		doc.Publisher = "Fortinet"
		doc.Release = docsFortiOSRelease
		out = append(out, doc)
	}
	return out
}

// vendorDocPaths is every CMDB path with a documentation link, for the test that keeps this table
// and the fix builders in step.
func vendorDocPaths() []string {
	out := make([]string, 0, len(vendorDocs))
	for p := range vendorDocs {
		out = append(out, p)
	}
	return out
}
