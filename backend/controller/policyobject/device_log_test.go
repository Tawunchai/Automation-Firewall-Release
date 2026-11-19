package policyobject

import (
	"strings"
	"testing"

	"network_automation/services"
)

// The CSV export.
//
// It reads from `Raw` — the device's own fields, as text — rather than from the typed struct, so
// that the file carries exactly what the firewall said. The risk that creates is the same one the
// table has: a field FortiOS omitted must become an EMPTY CELL, never a zero. A spreadsheet column
// reading `0` for the source port of every ping is a fabricated measurement, and unlike the screen
// it will outlive the session and be pasted into a report.

// icmpRow is the shape that matters: no `srcport`/`dstport` keys at all, which is how FortiOS
// really sends an ICMP entry.
func icmpRow() services.FGTrafficLog {
	return services.FGTrafficLog{
		Row:       2,
		Timestamp: 1787813538000,
		ProtoName: "ICMP",
		Archive:   true,
		Raw: map[string]string{
			"date": "2026-08-26", "time": "23:52:18", "tz": "-0700",
			"action": "accept", "level": "notice",
			"srcip": "10.10.20.227", "srcintf": "port1", "srccountry": "Reserved",
			"srcmac": "00:09:0f:09:00:00", "devtype": "Router",
			"dstip": "10.0.99.201", "dstintf": "root", "dstcountry": "Reserved",
			"proto": "1", "service": "PING", "app": "PING", "appcat": "unscanned",
			"policyid": "0", "policytype": "local-in-policy",
			"duration": "63", "sentbyte": "240", "rcvdbyte": "240",
			"sentpkt": "4", "rcvdpkt": "4", "sessionid": "3566",
			"logid": "0001000014", "vd": "root",
			// No srcport. No dstport. No srcname. No crlevel. Exactly as captured.
		},
	}
}

// cell returns the value of one named column from a rendered row.
func cell(t *testing.T, rec []string, column string) string {
	t.Helper()
	for i, name := range csvColumns {
		if name == column {
			if i >= len(rec) {
				t.Fatalf("row is shorter than the header: %d cells, column %q is at %d", len(rec), column, i)
			}
			return rec[i]
		}
	}
	t.Fatalf("%q is not a CSV column", column)
	return ""
}

func TestCSVRow_MatchesTheHeaderWidth(t *testing.T) {
	rec := csvRow(icmpRow())
	if len(rec) != len(csvColumns) {
		t.Fatalf("row has %d cells, header has %d — the columns would be shifted", len(rec), len(csvColumns))
	}
}

func TestCSVRow_AbsentPortIsAnEmptyCellNotZero(t *testing.T) {
	rec := csvRow(icmpRow())

	if got := cell(t, rec, "srcport"); got != "" {
		t.Errorf("srcport = %q, want an empty cell — the device sent no port for ICMP", got)
	}
	if got := cell(t, rec, "dstport"); got != "" {
		t.Errorf("dstport = %q, want an empty cell", got)
	}
	// And a field that IS present is carried through unchanged.
	if got := cell(t, rec, "srcip"); got != "10.10.20.227" {
		t.Errorf("srcip = %q", got)
	}
}

func TestCSVRow_PolicyZeroIsKeptBecauseItIsAValue(t *testing.T) {
	// 0 is the implicit local-in policy, not "no policy". It comes from Raw, so it survives as the
	// literal the device wrote.
	if got := cell(t, csvRow(icmpRow()), "policyid"); got != "0" {
		t.Errorf("policyid = %q, want \"0\"", got)
	}
}

func TestCSVRow_ProtocolIsTheNameNotTheNumber(t *testing.T) {
	// A spreadsheet column of 6s and 17s is unreadable, and the number is still in the raw log.
	if got := cell(t, csvRow(icmpRow()), "proto"); got != "ICMP" {
		t.Errorf("proto = %q, want ICMP", got)
	}
}

func TestCSVRow_ArchiveComesFromTheTypedFieldNotRaw(t *testing.T) {
	// `archive` lives in `_metadata`, which is deliberately excluded from Raw, so it has to be
	// rendered from the struct or the paperclip column would be blank in every export.
	if got := cell(t, csvRow(icmpRow()), "archive"); got != "true" {
		t.Errorf("archive = %q, want true", got)
	}
	plain := icmpRow()
	plain.Archive = false
	if got := cell(t, csvRow(plain), "archive"); got != "false" {
		t.Errorf("archive = %q, want false", got)
	}
}

func TestCSVRow_SurvivesARowWithNoRawAtAll(t *testing.T) {
	// A malformed entry must still produce a full-width row rather than panicking or shifting
	// every column of the file after it.
	rec := csvRow(services.FGTrafficLog{})
	if len(rec) != len(csvColumns) {
		t.Fatalf("row has %d cells, want %d", len(rec), len(csvColumns))
	}
	for i, v := range rec {
		if csvColumns[i] == "archive" {
			continue // rendered from the struct, so it is "false" rather than empty
		}
		if csvColumns[i] == "proto" {
			continue // ProtoName("") is "", which is what this asserts anyway
		}
		if v != "" {
			t.Errorf("column %q = %q, want empty for a row carrying nothing", csvColumns[i], v)
		}
	}
}

func TestCSVColumns_LeadWithWhatTheTableShows(t *testing.T) {
	// Someone opening the export should meet the same columns they were just looking at, in the
	// same order, before the extra fields the screen had no room for.
	head := strings.Join(csvColumns[:5], ",")
	if head != "date,time,tz,action,level" {
		t.Errorf("leading columns = %q", head)
	}
	for _, want := range []string{"srcip", "dstip", "app", "sentbyte", "rcvdbyte"} {
		found := false
		for _, c := range csvColumns {
			if c == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("%q is on screen but missing from the export", want)
		}
	}
}

func TestCSVRow_ResolvesThePolicyBesideItsId(t *testing.T) {
	// "8" is not an answer; "#8 Block-FB-YT-172.16.100.123" is the one somebody exports this file
	// to find. The id stays in its own column beside it.
	id := 8
	row := icmpRow()
	row.PolicyID = &id
	row.PolicyType = "policy"
	row.Policy = &services.LogPolicyRef{Name: "Block-FB-YT-172.16.100.123", Action: "accept", Exists: true}
	row.Raw["policyid"] = "8"

	rec := csvRow(row)
	if got := cell(t, rec, "policy"); got != "#8 Block-FB-YT-172.16.100.123" {
		t.Errorf("policy = %q", got)
	}
	if got := cell(t, rec, "policyid"); got != "8" {
		t.Errorf("policyid = %q, want the raw number kept alongside", got)
	}
}

func TestCSVRow_NamesTheImplicitRule(t *testing.T) {
	// policyid 0 exports as words rather than "0", because "0" reads as "no policy" and it is not:
	// it is the implicit rule, and which one depends on policytype.
	id := 0
	row := icmpRow()
	row.PolicyID = &id
	row.PolicyType = "local-in-policy"
	row.Policy = &services.LogPolicyRef{Implicit: true, Action: "accept", Exists: true}
	if got := cell(t, csvRow(row), "policy"); got != "implicit local-in" {
		t.Errorf("policy = %q", got)
	}

	row.PolicyType = "policy"
	row.Policy = &services.LogPolicyRef{Implicit: true, Action: "deny", Exists: true}
	if got := cell(t, csvRow(row), "policy"); got != "implicit deny" {
		t.Errorf("policy = %q", got)
	}
}
