package services

import (
	"fmt"
	"sort"
	"strings"
)

// A traffic log, reduced to something that fits in a prompt.
//
// ── WHY A DIGEST AND NOT THE ROWS ────────────────────────────────────────────
// Two hundred log entries are roughly 90 KB of JSON. Sending that to a model would be slow,
// expensive, and — the part that matters — would hand a third party a list of who talked to what,
// with internal addresses, usernames and MAC addresses attached. A traffic log is surveillance
// data about people, which is why reading it is admin-only in the first place (see
// controller/policyobject/device_log.go).
//
// So what leaves this process is counts. Addresses appear only where they are the answer — the top
// few talkers — and nothing per-row goes anywhere. The digest is also what the answer is grounded
// in: the model is told these are the only figures it has, so it cannot describe rows it never saw.
//
// ── IT COUNTS, IT DOES NOT JUDGE ─────────────────────────────────────────────
// No blocked/allowed classification happens here. That interpretation lives in one place — the
// browser's insight.ts, which the operator can see the workings of — and duplicating it in Go
// would give the page two answers that drift apart. This side supplies raw, checkable counts:
// actions as the device wrote them, directions from the interface fields, and totals.

// DigestItem is one entry in a ranked list.
type DigestItem struct {
	Label string
	Count int
	Bytes int64
}

// LogDigest is what one page of a traffic log adds up to.
type LogDigest struct {
	Rows        int
	FromMS      int64
	ToMS        int64
	SpanMinutes float64
	Bytes       int64

	// LocalOut is traffic the unit ORIGINATED — srcintf naming the vdom means the packet arrived
	// on no interface. Inbound arrived on one and was addressed to the unit. Loopback is both.
	LocalOut int
	Inbound  int
	Loopback int

	// Actions as the device wrote them: accept, close, server-rst, deny, …
	Actions map[string]int
	// Policies by resolved label, so "implicit local-in" and "#8 Block-Social" are distinguishable.
	Policies map[string]int
	// ThreatLevels is empty on a unit whose UTM engine scored nothing, and stays empty rather than
	// becoming a "none" the model could read as "scanned and clean".
	ThreatLevels map[string]int

	TopDestinations []DigestItem
	TopSources      []DigestItem
	TopServices     []DigestItem
	TopCountries    []DigestItem
}

const digestTop = 6

// SummariseTrafficLog reduces rows to a digest. Pure: no device call, no clock.
func SummariseTrafficLog(rows []FGTrafficLog, subcategory string) LogDigest {
	d := LogDigest{
		Actions:      map[string]int{},
		Policies:     map[string]int{},
		ThreatLevels: map[string]int{},
		Rows:         len(rows),
	}
	if len(rows) == 0 {
		return d
	}

	dst := map[string]*DigestItem{}
	src := map[string]*DigestItem{}
	svc := map[string]*DigestItem{}
	cty := map[string]*DigestItem{}

	d.FromMS, d.ToMS = rows[0].Timestamp, rows[0].Timestamp
	for i := range rows {
		r := &rows[i]
		if r.Timestamp < d.FromMS {
			d.FromMS = r.Timestamp
		}
		if r.Timestamp > d.ToMS {
			d.ToMS = r.Timestamp
		}
		bytes := r.SentByte + r.RcvdByte
		d.Bytes += bytes

		fromDevice := r.VDom != "" && r.SrcIntf == r.VDom
		toDevice := r.VDom != "" && r.DstIntf == r.VDom
		switch {
		case fromDevice && toDevice:
			d.Loopback++
		case fromDevice:
			d.LocalOut++
		default:
			d.Inbound++
		}

		if r.Action != "" {
			d.Actions[r.Action]++
		}
		if label := PolicyLabel(r.PolicyID, r.PolicyType, r.Policy); label != "" {
			d.Policies[label]++
		}
		if r.CRLevel != "" {
			d.ThreatLevels[r.CRLevel]++
		}

		// The resolved host is worth more than the address when the device supplied one, but the
		// address stays attached: two servers commonly answer to one name.
		add(dst, r.DstIP, hostLabel(r.DstHost, r.DstName, r.DstIP), bytes)
		add(src, r.SrcIP, hostLabel(r.SrcHost, r.SrcName, r.SrcIP), bytes)
		add(svc, serviceLabel(r), serviceLabel(r), bytes)
		// "Reserved" is what FortiOS says about RFC1918 space, not a country.
		if r.DstCountry != "" && r.DstCountry != "Reserved" {
			add(cty, r.DstCountry, r.DstCountry, bytes)
		}
	}

	d.SpanMinutes = float64(d.ToMS-d.FromMS) / 60000
	d.TopDestinations = rank(dst)
	d.TopSources = rank(src)
	d.TopServices = rank(svc)
	d.TopCountries = rank(cty)
	return d
}

func hostLabel(host, name, ip string) string {
	switch {
	case host != "" && host != ip:
		return host + " (" + ip + ")"
	case name != "" && name != ip:
		return name + " (" + ip + ")"
	default:
		return ip
	}
}

func serviceLabel(r *FGTrafficLog) string {
	if r.Service != "" {
		return r.Service
	}
	if r.DstPort != nil {
		return fmt.Sprintf("%s/%d", r.ProtoName, *r.DstPort)
	}
	return ""
}

func add(into map[string]*DigestItem, key, label string, bytes int64) {
	if key == "" {
		return
	}
	at, ok := into[key]
	if !ok {
		at = &DigestItem{Label: label}
		into[key] = at
	}
	at.Count++
	at.Bytes += bytes
}

func rank(from map[string]*DigestItem) []DigestItem {
	out := make([]DigestItem, 0, len(from))
	for _, it := range from {
		out = append(out, *it)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Label < out[j].Label
	})
	if len(out) > digestTop {
		out = out[:digestTop]
	}
	return out
}

// Text renders the digest for a prompt: short, labelled, and with nothing in it that is not a
// count of the rows that were read.
func (d LogDigest) Text() string {
	if d.Rows == 0 {
		return "The log returned no entries."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Entries read: %d over %.0f minutes, %s total.\n", d.Rows, d.SpanMinutes, humanBytes(d.Bytes))
	fmt.Fprintf(&b, "Direction: %d originated by the firewall itself (local-out), %d addressed to it, %d loopback.\n",
		d.LocalOut, d.Inbound, d.Loopback)
	fmt.Fprintf(&b, "Actions: %s\n", counts(d.Actions))
	fmt.Fprintf(&b, "Policy shown: %s\n", counts(d.Policies))
	if len(d.ThreatLevels) > 0 {
		fmt.Fprintf(&b, "Threat levels recorded: %s\n", counts(d.ThreatLevels))
	} else {
		b.WriteString("Threat levels recorded: none at all — the UTM engine scored nothing on these rows.\n")
	}
	writeList(&b, "Top destinations", d.TopDestinations)
	writeList(&b, "Top sources", d.TopSources)
	writeList(&b, "Top services", d.TopServices)
	writeList(&b, "Top destination countries", d.TopCountries)
	return b.String()
}

func writeList(b *strings.Builder, title string, items []DigestItem) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(b, "%s:\n", title)
	for _, it := range items {
		fmt.Fprintf(b, "  %s — %d entries, %s\n", it.Label, it.Count, humanBytes(it.Bytes))
	}
}

func counts(m map[string]int) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if m[keys[i]] != m[keys[j]] {
			return m[keys[i]] > m[keys[j]]
		}
		return keys[i] < keys[j]
	})
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s %d", k, m[k]))
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, ", ")
}

func humanBytes(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.2f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.2f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f kB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}
