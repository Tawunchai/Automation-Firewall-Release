package services

import (
	"strconv"
	"strings"
)

// Applying the search here, because the device only half does.
//
// ── WHAT WAS MEASURED ──────────────────────────────────────────────────────
// On the lab FGT80E (FortiOS 7.2.10, memory backend), reading 1000 rows so that the answer is not
// confused with a page of them:
//
//	filter sent                                    result
//	srcip==1.2.3.4                                 0 rows                     honoured
//	action==server-rst                             1000 rows, all server-rst  honoured
//	dstport==443                                   1000 rows, all port 443    honoured
//	action=*zzz*,service=*zzz*,… (one parameter)    EVERY row in the buffer    IGNORED
//
// A single `field op value` term is applied by the device. The COMMA-OR form is not: it is
// accepted, reported as applied, and then has no effect at all.
//
// That form is what every free-text search becomes — typing `deny` searches a dozen fields at once
// (see freeTextFilter). So a word that matched nothing returned the entire log, and the page
// presented all of it as the result. Somebody searching for a host they were worried about would
// have been shown every host's traffic under their own search term.
//
// It is the same class of fault this area keeps meeting, one level further out: fortigate_log.go
// records the device ignoring the SUBCATEGORY it was asked for, and fortigate_logsearch.go records
// a bare `=` matching everything. Each time, the device accepts the request, reports success, and
// does something else.
//
// ── WHY EVERY TERM IS RE-CHECKED, NOT ONLY THE OR ONES ─────────────────────────
// Because "which forms does this firmware honour" is not a thing worth encoding as a branch. The
// filter is still SENT — a backend that applies it returns less over the wire, which is worth
// having — and then checked here regardless. Re-checking a term the device already applied is a
// no-op over at most a thousand rows; getting the branch wrong is a silently unfiltered log.
//
// ── THE COUNT IN THE FOOTER IS THE MATCHING COUNT ─────────────────────────────
// page.Total is computed after this runs, so "1–20 of 36" means 36 rows matched, not "36 rows came
// back". A number counting the unfiltered read under a filtered table would be its own version of
// the same lie.

// LogClause is one `field op value` comparison.
type LogClause struct {
	Field string
	Op    string
	Value string
}

// LogTerm is one search term: the clauses are ORed, and terms are ANDed with each other.
//
// A field term has exactly one clause. Free text expands to several — typing `deny` looks in
// action, service, app and the rest — which is why a term is a list rather than a clause.
type LogTerm struct {
	Clauses []LogClause
	// Filter is the string sent to the device for this term. Kept so the page can show the real
	// query, and so what is sent and what is checked can never describe different searches.
	Filter string
}

// MatchLogRow reports whether a row satisfies every term.
func MatchLogRow(r *FGTrafficLog, terms []LogTerm) bool {
	for _, t := range terms {
		if !t.matches(r) {
			return false
		}
	}
	return true
}

func (t LogTerm) matches(r *FGTrafficLog) bool {
	if len(t.Clauses) == 0 {
		return true
	}
	for _, c := range t.Clauses {
		if c.matches(r) {
			return true
		}
	}
	return false
}

func (c LogClause) matches(r *FGTrafficLog) bool {
	got, present := logFieldOf(r, c.Field)

	// An absent field cannot equal anything. It CAN differ from something, which is what `!=`
	// asks — a row with no `user` really does have a user other than "bob".
	if !present {
		return c.Op == "!="
	}

	switch c.Op {
	case "==":
		return strings.EqualFold(got, c.Value)
	case "!=":
		return !strings.EqualFold(got, c.Value)
	case "=":
		// Only ever a wildcard by the time it reaches here: normaliseEquality turns a plain `=`
		// into `==` precisely because the device reads it as a match-everything pattern.
		return globMatch(c.Value, got)
	case ">", ">=", "<", "<=":
		a, errA := strconv.ParseFloat(got, 64)
		b, errB := strconv.ParseFloat(c.Value, 64)
		if errA != nil || errB != nil {
			// A comparison against something that is not a number is not a match. It is also not
			// an error here: the search parser already refuses those, so reaching this line means
			// the FIELD held a non-number, and the honest answer is that it does not compare.
			return false
		}
		switch c.Op {
		case ">":
			return a > b
		case ">=":
			return a >= b
		case "<":
			return a < b
		default:
			return a <= b
		}
	default:
		return false
	}
}

// globMatch is `*`-only wildcard matching, case-insensitive.
//
// `*` is the only metacharacter the device's filter language has, so nothing else is treated as
// one: a `.` in `*fortinet.net*` is a full stop, not "any character".
func globMatch(pattern, s string) bool {
	pattern, s = strings.ToLower(pattern), strings.ToLower(s)
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == s
	}

	// A pattern not starting with `*` is anchored at the front, and likewise at the end.
	if parts[0] != "" {
		if !strings.HasPrefix(s, parts[0]) {
			return false
		}
		s = s[len(parts[0]):]
	}
	last := parts[len(parts)-1]
	if last != "" {
		if !strings.HasSuffix(s, last) {
			return false
		}
		s = s[:len(s)-len(last)]
	}
	for _, part := range parts[1 : len(parts)-1] {
		if part == "" {
			continue
		}
		i := strings.Index(s, part)
		if i < 0 {
			return false
		}
		s = s[i+len(part):]
	}
	return true
}

// logFieldOf reads one field off a row by its search name.
//
// The map is the same set of names BuildSearchFilter validates against, so a term that passed the
// parser always resolves here. `present` is false where FortiOS omitted the field — a nil port on
// an ICMP row — which is not the same as an empty one.
func logFieldOf(r *FGTrafficLog, field string) (string, bool) {
	switch strings.ToLower(field) {
	case "srcip":
		return r.SrcIP, r.SrcIP != ""
	case "dstip":
		return r.DstIP, r.DstIP != ""
	case "srcport":
		return intField(r.SrcPort)
	case "dstport":
		return intField(r.DstPort)
	case "policyid":
		return intField(r.PolicyID)
	case "proto":
		return strconv.Itoa(r.Proto), true
	case "sessionid":
		return strconv.FormatInt(r.SessionID, 10), r.SessionID != 0
	case "duration":
		return strconv.Itoa(r.Duration), true
	case "sentbyte":
		return strconv.FormatInt(r.SentByte, 10), true
	case "rcvdbyte":
		return strconv.FormatInt(r.RcvdByte, 10), true
	case "sentpkt":
		return strconv.FormatInt(r.SentPkt, 10), true
	case "rcvdpkt":
		return strconv.FormatInt(r.RcvdPkt, 10), true
	case "crscore":
		return intField(r.CRScore)
	case "action":
		return r.Action, r.Action != ""
	case "service":
		return r.Service, r.Service != ""
	case "app":
		return r.App, r.App != ""
	case "appcat":
		return r.AppCat, r.AppCat != ""
	case "srcintf":
		return r.SrcIntf, r.SrcIntf != ""
	case "dstintf":
		return r.DstIntf, r.DstIntf != ""
	case "srcintfrole":
		return r.SrcIntfRole, r.SrcIntfRole != ""
	case "dstintfrole":
		return r.DstIntfRole, r.DstIntfRole != ""
	case "user":
		return r.User, r.User != ""
	case "group":
		return r.Group, r.Group != ""
	case "level":
		return r.Level, r.Level != ""
	case "policytype":
		return r.PolicyType, r.PolicyType != ""
	case "srccountry":
		return r.SrcCountry, r.SrcCountry != ""
	case "dstcountry":
		return r.DstCountry, r.DstCountry != ""
	case "devtype":
		return r.SrcDevType, r.SrcDevType != ""
	case "dstdevtype":
		return r.DstDevType, r.DstDevType != ""
	case "srcmac":
		return r.SrcMAC, r.SrcMAC != ""
	case "dstmac":
		return r.DstMAC, r.DstMAC != ""
	case "srcname":
		return r.SrcName, r.SrcName != ""
	case "dstname":
		return r.DstName, r.DstName != ""
	case "srchwvendor":
		return r.SrcHWVendor, r.SrcHWVendor != ""
	case "dsthwvendor":
		return r.DstHWVendor, r.DstHWVendor != ""
	case "trandisp":
		return r.TranDisp, r.TranDisp != ""
	case "crlevel":
		return r.CRLevel, r.CRLevel != ""
	case "logid":
		return r.LogID, r.LogID != ""
	case "vd":
		return r.VDom, r.VDom != ""
	case "subtype":
		return r.Subtype, r.Subtype != ""
	case "msg":
		return r.Message, r.Message != ""
	case "osname":
		return r.SrcOSName, r.SrcOSName != ""
	default:
		// Unreachable through the parser, which refuses unknown field names. Absent rather than
		// empty, so an unknown name cannot quietly match every row with a blank value.
		return "", false
	}
}

func intField(p *int) (string, bool) {
	if p == nil {
		return "", false
	}
	return strconv.Itoa(*p), true
}
