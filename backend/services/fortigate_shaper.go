package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var shaperTrafficShaperTable = cmdbPath{path: "firewall.shaper/traffic-shaper", noun: "traffic shaper"}
var shapingPolicyTable = cmdbPath{path: "firewall/shaping-policy", noun: "shaping policy"}

// Policy & Objects ▸ Traffic Shaping — how much bandwidth a class of traffic may have.
//
// Two objects, and the relationship between them is the part that is easy to get wrong:
//
//	firewall.shaper/traffic-shaper   the LIMIT itself: a guaranteed floor, a maximum ceiling, a
//	                                 priority. It shapes nothing on its own.
//	firewall/shaping-policy          WHICH traffic gets that limit: a match (source, destination,
//	                                 service, application) plus the shaper to apply in each
//	                                 direction.
//
// A shaper with no shaping policy is a number nobody reads — which is exactly what the device shows
// you, silently, because both halves are valid on their own. The list surfaces the count of
// policies using each shaper for that reason.
//
// Schema read live off FortiGate 7.2.10 (FGT80E).
//
// ⚠️ The trap worth the file: `per-policy`.
//
// With per-policy DISABLED (the default), a shaper's maximum is shared by everything that matches —
// one 10 Mbps shaper on three policies is 10 Mbps total. With it ENABLED, each policy gets its own
// 10 Mbps. The field is one enable/disable string and the difference is a factor of however many
// policies use it, so a shaper that "works in testing" and starves in production is usually this.
// The UI says which one is in force rather than showing a checkbox called "Per Policy".

// ── The shaper ───────────────────────────────────────────────────────────────

type FGTrafficShaper struct {
	Name string `json:"name"`
	// Guaranteed is the floor this class is never squeezed below; Maximum is its ceiling. Both are
	// in BandwidthUnit.
	Guaranteed    int    `json:"guaranteed_bandwidth"`
	Maximum       int    `json:"maximum_bandwidth"`
	BandwidthUnit string `json:"bandwidth_unit"` // kbps | mbps | gbps
	Priority      string `json:"priority"`       // low | medium | high
	// PerPolicy: see the trap above.
	PerPolicy    bool   `json:"per_policy"`
	DiffServ     bool   `json:"diffserv"`
	DiffServCode string `json:"diffservcode,omitempty"`

	// Derived, for the list: how many shaping policies point at this shaper in either direction.
	// A shaper nothing uses shapes nothing.
	UsedBy int `json:"used_by"`
}

type fgTrafficShaperRaw struct {
	Name          string `json:"name"`
	Guaranteed    int    `json:"guaranteed-bandwidth"`
	Maximum       int    `json:"maximum-bandwidth"`
	BandwidthUnit string `json:"bandwidth-unit"`
	Priority      string `json:"priority"`
	PerPolicy     string `json:"per-policy"`
	DiffServ      string `json:"diffserv"`
	DiffServCode  string `json:"diffservcode"`
}

func (r fgTrafficShaperRaw) toGUI() FGTrafficShaper {
	return FGTrafficShaper{
		Name:          r.Name,
		Guaranteed:    r.Guaranteed,
		Maximum:       r.Maximum,
		BandwidthUnit: r.BandwidthUnit,
		Priority:      r.Priority,
		PerPolicy:     isOn(r.PerPolicy),
		DiffServ:      isOn(r.DiffServ),
		DiffServCode:  r.DiffServCode,
	}
}

func trafficShaperPayload(s FGTrafficShaper) map[string]any {
	unit := s.BandwidthUnit
	if unit == "" {
		unit = "kbps"
	}
	prio := s.Priority
	if prio == "" {
		prio = "high"
	}
	body := map[string]any{
		"name":                 s.Name,
		"guaranteed-bandwidth": s.Guaranteed,
		"maximum-bandwidth":    s.Maximum,
		"bandwidth-unit":       unit,
		"priority":             prio,
		"per-policy":           onOff(s.PerPolicy),
		"diffserv":             onOff(s.DiffServ),
	}
	// diffservcode is only meaningful with diffserv on, and FortiOS refuses a malformed code.
	if s.DiffServ && s.DiffServCode != "" {
		body["diffservcode"] = s.DiffServCode
	}
	return body
}

// GetTrafficShapers lists the shapers, each with the number of shaping policies using it.
//
// The usage count is why this reads both tables: a shaper on its own is a number, and the one
// thing the list has to answer at a glance is whether it is attached to anything.
func (f *FortiClient) GetTrafficShapers() ([]FGTrafficShaper, error) {
	raw, err := cmdbRaws[fgTrafficShaperRaw](f, shaperTrafficShaperTable)
	if err != nil {
		return nil, err
	}

	// A failed policy read must not turn every shaper into "used by 0" — that would read as
	// "nothing uses these, delete them". Left at -1 so the UI can say it does not know.
	used := map[string]int{}
	knowUsage := true
	policies, perr := f.GetShapingPolicies()
	if perr != nil {
		knowUsage = false
	} else {
		for _, p := range policies {
			if p.TrafficShaper != "" {
				used[p.TrafficShaper]++
			}
			if p.TrafficShaperReverse != "" && p.TrafficShaperReverse != p.TrafficShaper {
				used[p.TrafficShaperReverse]++
			}
		}
	}

	out := make([]FGTrafficShaper, 0, len(raw))
	for _, r := range raw {
		s := r.toGUI()
		if knowUsage {
			s.UsedBy = used[s.Name]
		} else {
			s.UsedBy = -1
		}
		out = append(out, s)
	}
	return out, nil
}

func (f *FortiClient) GetTrafficShaper(name string) (*FGTrafficShaper, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall.shaper/traffic-shaper/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var raw []fgTrafficShaperRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse traffic shaper: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("traffic shaper %q not found", name)
	}
	s := raw[0].toGUI()
	return &s, nil
}

func (f *FortiClient) CreateTrafficShaper(s FGTrafficShaper) error {
	return shaperTrafficShaperTable.Create(f, trafficShaperPayload(s))
}

func (f *FortiClient) UpdateTrafficShaper(name string, s FGTrafficShaper) error {
	return shaperTrafficShaperTable.Update(f, name, trafficShaperPayload(s))
}

func (f *FortiClient) DeleteTrafficShaper(name string) error {
	return shaperTrafficShaperTable.Delete(f, name)
}

// ── The shaping policy ───────────────────────────────────────────────────────

type FGShapingPolicy struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Status  bool   `json:"status"`
	Comment string `json:"comment"`

	SrcAddr []string `json:"srcaddr"`
	DstAddr []string `json:"dstaddr"`
	SrcIntf []string `json:"srcintf"`
	DstIntf []string `json:"dstintf"`
	Service []string `json:"service"`

	// The shapers. Forward is source→destination; reverse is the traffic coming back, and it is
	// the half people forget: a download limit set only in the forward direction shapes the
	// REQUESTS, not the file.
	TrafficShaper        string `json:"traffic_shaper"`
	TrafficShaperReverse string `json:"traffic_shaper_reverse"`
	PerIPShaper          string `json:"per_ip_shaper"`
}

type fgShapingPolicyRaw struct {
	ID                   int          `json:"id"`
	Name                 string       `json:"name"`
	Status               string       `json:"status"`
	Comment              string       `json:"comment"`
	SrcAddr              fgMemberList `json:"srcaddr"`
	DstAddr              fgMemberList `json:"dstaddr"`
	SrcIntf              fgMemberList `json:"srcintf"`
	DstIntf              fgMemberList `json:"dstintf"`
	Service              fgMemberList `json:"service"`
	TrafficShaper        string       `json:"traffic-shaper"`
	TrafficShaperReverse string       `json:"traffic-shaper-reverse"`
	PerIPShaper          string       `json:"per-ip-shaper"`
}

func (r fgShapingPolicyRaw) toGUI() FGShapingPolicy {
	return FGShapingPolicy{
		ID: r.ID, Name: r.Name, Status: isOn(r.Status), Comment: r.Comment,
		SrcAddr: r.SrcAddr.names(), DstAddr: r.DstAddr.names(),
		SrcIntf: r.SrcIntf.names(), DstIntf: r.DstIntf.names(),
		Service:              r.Service.names(),
		TrafficShaper:        r.TrafficShaper,
		TrafficShaperReverse: r.TrafficShaperReverse,
		PerIPShaper:          r.PerIPShaper,
	}
}

func shapingPolicyPayload(p FGShapingPolicy) map[string]any {
	body := map[string]any{
		"name":       p.Name,
		"status":     onOff(p.Status),
		"comment":    p.Comment,
		"ip-version": "4",
		"srcaddr":    toMembers(p.SrcAddr),
		"dstaddr":    toMembers(p.DstAddr),
		"srcintf":    toMembers(p.SrcIntf),
		"dstintf":    toMembers(p.DstIntf),
		"service":    toMembers(p.Service),
	}
	// The three shaper slots are sent only when set. An empty string is accepted and clears the
	// slot, which is right on an edit and wrong on a create that never mentioned it.
	body["traffic-shaper"] = p.TrafficShaper
	body["traffic-shaper-reverse"] = p.TrafficShaperReverse
	body["per-ip-shaper"] = p.PerIPShaper
	return body
}

func (f *FortiClient) GetShapingPolicies() ([]FGShapingPolicy, error) {
	raw, err := cmdbRaws[fgShapingPolicyRaw](f, shapingPolicyTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGShapingPolicy, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

func (f *FortiClient) CreateShapingPolicy(p FGShapingPolicy) error {
	return shapingPolicyTable.Create(f, shapingPolicyPayload(p))
}

func (f *FortiClient) UpdateShapingPolicy(id int, p FGShapingPolicy) error {
	_, err := f.do("PUT", fmt.Sprintf("/api/v2/cmdb/firewall/shaping-policy/%d", id), shapingPolicyPayload(p))
	return err
}

func (f *FortiClient) DeleteShapingPolicy(id int) error {
	return shapingPolicyTable.Delete(f, strconv.Itoa(id))
}
