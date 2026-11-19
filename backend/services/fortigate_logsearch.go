package services

import (
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
)

// Turning what someone types in the search box into a filter the device will honour.
//
// ── WHY THIS IS NOT A PASS-THROUGH ───────────────────────────────────────────
// The device's filter parameter is not validated by the device. A filter naming a field that does
// not exist answers `200 / total_lines: 0` — verified: `filter=zzz==qqq` returns success with zero
// rows. So every typo becomes "no results", and the page would be telling someone their firewall
// saw no traffic when the truth is that they misspelled `srcip`.
//
// Everything here exists to make that impossible: a term is either understood and sent, or
// refused with a message naming what was wrong. Nothing is forwarded on a guess.
//
// ── WHAT THE BOX ACCEPTS ─────────────────────────────────────────────────────
//
//	10.0.99.201            free text  → OR across the fields that can hold it
//	443                    a number   → OR across the port / id fields
//	deny                   a word     → OR across the word-ish fields, wildcarded
//	srcip==10.0.99.201     a term     → sent as written, after the field is checked
//	dstport>=1024          a term     → the comparison operators the device supports
//	action==deny 10.0.0.1  two terms  → ANDed, as repeated filter parameters
//
// Space separates terms and means AND, which matches the device's own semantics (AND is a
// repeated parameter; see buildLogPath). Quoting a phrase keeps it as one term.

// logSearchFields is every field name a term may address, mapped to how its values behave.
//
// Taken from real rows off the lab device, not from the log reference: the reference lists fields
// this firmware never emits, and offering one of those would be another silent zero.
var logSearchFields = map[string]logFieldKind{
	"srcip": fieldIP, "dstip": fieldIP,
	"srcport": fieldNumber, "dstport": fieldNumber, "policyid": fieldNumber,
	"proto": fieldNumber, "sessionid": fieldNumber, "duration": fieldNumber,
	"sentbyte": fieldNumber, "rcvdbyte": fieldNumber, "sentpkt": fieldNumber, "rcvdpkt": fieldNumber,
	"crscore": fieldNumber,

	"action": fieldWord, "service": fieldWord, "app": fieldWord, "appcat": fieldWord,
	"srcintf": fieldWord, "dstintf": fieldWord, "srcintfrole": fieldWord, "dstintfrole": fieldWord,
	"user": fieldWord, "group": fieldWord, "level": fieldWord, "policytype": fieldWord,
	"srccountry": fieldWord, "dstcountry": fieldWord, "devtype": fieldWord, "dstdevtype": fieldWord,
	"srcmac": fieldWord, "dstmac": fieldWord, "srcname": fieldWord, "dstname": fieldWord,
	"srchwvendor": fieldWord, "dsthwvendor": fieldWord, "trandisp": fieldWord, "crlevel": fieldWord,
	"logid": fieldWord, "vd": fieldWord, "subtype": fieldWord, "msg": fieldWord, "osname": fieldWord,
}

type logFieldKind int

const (
	fieldWord logFieldKind = iota
	fieldNumber
	fieldIP
)

// logSearchFieldNames lists the field names the search box understands, sorted, for the UI's hint and
// for the "unknown field" message to suggest from.
func logSearchFieldNames() []string {
	out := make([]string, 0, len(logSearchFields))
	for name := range logSearchFields {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// freeTextIPFields is where a bare IP address is looked for.
var freeTextIPFields = []string{"srcip", "dstip"}

// freeTextNumberFields is where a bare number is looked for. Ports first: someone typing 443 means
// a port far more often than a policy id, and the OR makes the guess cost nothing.
var freeTextNumberFields = []string{"srcport", "dstport", "policyid", "sessionid"}

// freeTextWordFields is where a bare word is looked for, wildcarded at both ends.
//
// `msg` is deliberately absent even though it is the most likely place for a word to appear:
// traffic logs on this firmware carry no `msg` at all (event logs do), so including it would
// widen every search by a field that is never populated. It stays available as an explicit term.
var freeTextWordFields = []string{
	"action", "service", "app", "appcat", "srcintf", "dstintf",
	"user", "srccountry", "dstcountry", "devtype", "srcname", "dstname", "level",
}

// comparisonOps are the operators the device accepts, longest first so that `>=` is matched before
// `>` and `==` before `=`. All verified live against the lab device: `==` `!=` `>` `<` `>=` `<=`.
//
// ⚠️ A BARE `=` IS NOT EQUALITY, AND FAILS OPEN. `filter=action=deny` returned all 34 rows in the
// buffer — every action, not the 15 denies. The device reads a `=` value as a wildcard pattern, so
// one without a `*` in it matches everything rather than nothing. That is the worst possible
// direction for a firewall log filter to be wrong in: the page would look like it had filtered and
// would be showing unfiltered data. normaliseEquality below is what stops it.
var comparisonOps = []string{"==", "!=", ">=", "<=", ">", "<", "="}

// wildcardPattern reports whether a value is meant as a wildcard match rather than an exact one.
// `action=*de*` matches the 15 deny rows; `action=deny` matches all 34. The `*` is the difference.
func wildcardPattern(v string) bool { return strings.Contains(v, "*") }

// normaliseEquality picks the operator that means what the person typing intended.
//
// A `=` with a wildcard in the value is a real wildcard match and is left alone. A `=` without one
// would match every row, so it becomes `==`, which is the exact match every other filter box in
// this console means by a single equals sign.
func normaliseEquality(op, value string) string {
	if op == "=" && !wildcardPattern(value) {
		return "=="
	}
	return op
}

// LogSearchError is a search the box could not turn into a filter. It is a distinct type because
// the handler answers it with 400 and the exact text, rather than the generic device error.
type LogSearchError struct {
	Term   string
	Reason string
}

func (e *LogSearchError) Error() string {
	if e.Term == "" {
		return e.Reason
	}
	return fmt.Sprintf("%s: %s", e.Term, e.Reason)
}

// BuildLogSearch turns the search box into terms that are both SENT to the device and checked here.
//
// An empty or whitespace-only search yields no terms and no error — that is "show everything".
//
// Both, because the device honours some forms and silently ignores others — see
// fortigate_logmatch.go for what was measured. The two halves come from one parse so that what is
// asked of the firewall and what is applied to its answer can never describe different searches.
func BuildLogSearch(search string) ([]LogTerm, error) {
	terms, err := splitTerms(search)
	if err != nil {
		return nil, err
	}

	out := make([]LogTerm, 0, len(terms))
	for _, term := range terms {
		parsed, err := termToFilter(term)
		if err != nil {
			return nil, err
		}
		if parsed.Filter != "" {
			out = append(out, parsed)
		}
	}
	return out, nil
}

// splitTerms breaks the search on whitespace, keeping quoted phrases whole.
//
// An unterminated quote is an error rather than being silently closed at end of input: a search
// for `app=="Microsoft Teams` should say so, not quietly search for one field value nobody asked
// for and report no results.
func splitTerms(search string) ([]string, error) {
	var (
		terms   []string
		current strings.Builder
		quote   rune
	)
	flush := func() {
		if current.Len() > 0 {
			terms = append(terms, current.String())
			current.Reset()
		}
	}

	for _, r := range search {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
		case r == ' ' || r == '\t' || r == '\n':
			flush()
		default:
			current.WriteRune(r)
		}
	}
	if quote != 0 {
		return nil, &LogSearchError{Reason: "unclosed quote in the search"}
	}
	flush()
	return terms, nil
}

// termToFilter turns one term into one device filter expression.
func termToFilter(term string) (LogTerm, error) {
	if field, op, value, ok := splitTerm(term); ok {
		return structuredFilter(term, field, op, value)
	}
	return freeTextFilter(term), nil
}

// splitTerm finds the operator in `field<op>value`, if there is one.
//
// The field name must be a plain identifier. That check is what stops `10.0.0.1` from being read
// as a term — it contains no operator — and stops `>=5` from being read as a field named "".
func splitTerm(term string) (field, op, value string, ok bool) {
	for _, candidate := range comparisonOps {
		idx := strings.Index(term, candidate)
		if idx <= 0 {
			continue
		}
		// `==` contains `=`; make sure a longer operator starting here wins.
		for _, longer := range comparisonOps {
			if len(longer) > len(candidate) && strings.HasPrefix(term[idx:], longer) {
				candidate = longer
			}
		}
		field = term[:idx]
		if !isIdentifier(field) {
			continue
		}
		return field, candidate, term[idx+len(candidate):], true
	}
	return "", "", "", false
}

// isIdentifier reports whether s looks like a log field name rather than part of a value.
func isIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		isLower := r >= 'a' && r <= 'z'
		isUpper := r >= 'A' && r <= 'Z'
		if !isLower && !isUpper && r != '_' && r != '-' {
			return false
		}
	}
	return true
}

// structuredFilter validates and renders an explicit `field<op>value` term.
func structuredFilter(term, field, op, value string) (LogTerm, error) {
	name := strings.ToLower(field)
	kind, known := logSearchFields[name]
	if !known {
		return LogTerm{}, &LogSearchError{
			Term:   term,
			Reason: fmt.Sprintf("%q is not a field in this log — the device would answer 'no results' rather than reject it", field),
		}
	}
	if value == "" {
		return LogTerm{}, &LogSearchError{Term: term, Reason: "no value after " + op}
	}

	// A numeric field compared against a non-number is the other silent-zero trap: `dstport==https`
	// is accepted by the device and matches nothing.
	if kind == fieldNumber && !isNumericValue(value) {
		return LogTerm{}, &LogSearchError{
			Term:   term,
			Reason: fmt.Sprintf("%s holds a number, and %q is not one", name, value),
		}
	}
	if kind == fieldIP && !wildcardPattern(value) && (op == "==" || op == "=") && !looksLikeIP(value) {
		return LogTerm{}, &LogSearchError{
			Term:   term,
			Reason: fmt.Sprintf("%s holds an IP address, and %q is not one (use %s=*%s* to match part of one)", name, value, name, value),
		}
	}

	final := normaliseEquality(op, value)
	return LogTerm{
		Clauses: []LogClause{{Field: name, Op: final, Value: value}},
		Filter:  name + final + value,
	}, nil
}

// freeTextFilter turns a bare word into an OR across the fields that could hold it.
//
// The OR is a comma inside ONE parameter — verified on the device — so this returns a single
// filter string. Nothing here can fail: every field named is on the known list by construction.
func freeTextFilter(text string) LogTerm {
	// An address or a number is looked for as an exact value, because a partial match on either
	// is meaningless: 10.0.99.201 is not "part of" 110.0.99.2018.
	if looksLikeIP(text) {
		return orTerms(freeTextIPFields, "==", text)
	}
	if isNumericValue(text) {
		return orTerms(freeTextNumberFields, "==", text)
	}
	// A word is wildcarded at both ends so that typing "goog" finds "Google.Services", which is
	// what a search box is expected to do.
	return orTerms(freeTextWordFields, "=", wrapWildcard(text))
}

// wrapWildcard surrounds text with `*` unless it already carries its own.
//
// The guard is not cosmetic: `action=**deny**` was verified to match ZERO rows while
// `action=*de*` matches 15, so a doubled star does not widen the search — it silently kills it.
// Anyone typing their own `*` gets the pattern they wrote.
func wrapWildcard(text string) string {
	if wildcardPattern(text) {
		return text
	}
	return "*" + text + "*"
}

// orTerms joins one value across several fields with the device's OR, which is a comma.
func orTerms(fields []string, op, value string) LogTerm {
	parts := make([]string, 0, len(fields))
	clauses := make([]LogClause, 0, len(fields))
	for _, f := range fields {
		parts = append(parts, f+op+value)
		clauses = append(clauses, LogClause{Field: f, Op: op, Value: value})
	}
	return LogTerm{Clauses: clauses, Filter: strings.Join(parts, ",")}
}

// isNumericValue reports whether v is a plain non-negative integer.
func isNumericValue(v string) bool {
	if v == "" {
		return false
	}
	n, err := strconv.ParseInt(v, 10, 64)
	return err == nil && n >= 0
}

// looksLikeIP reports whether v parses as an IPv4/IPv6 address or CIDR. Used to decide which
// fields a bare token should be searched in, so a partial address ("10.0.") deliberately does not
// count — it falls through to the word branch and is wildcarded instead.
func looksLikeIP(v string) bool {
	if net.ParseIP(v) != nil {
		return true
	}
	_, _, err := net.ParseCIDR(v)
	return err == nil
}
