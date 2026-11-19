package services

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var staticRouteTable = cmdbPath{path: "router/static", noun: "static route"}

// Static routes (router/static) — Network > Static Routes CRUD.
//
// Split out of fortigate.go verbatim.

// ── Static Routes (router/static) ─────────────────────────────────────────────
//
// Field names/enums confirmed live against a FortiGate 7.2.10 router/static CMDB
// schema. mkey is seq-num; "dst" is "ip mask"; a Blackhole route sets blackhole=enable
// with an empty device; an Internet Service route uses internet-service (an id) instead
// of dst.

// FGStaticRoute is the read model for the Static Routes page.
type FGStaticRoute struct {
	SeqNum              int    `json:"seq_num"`
	DstType             string `json:"dst_type"` // subnet | internet-service
	Dst                 string `json:"dst"`      // CIDR (subnet type)
	Gateway             string `json:"gateway"`
	Device              string `json:"device"` // interface name
	DeviceAlias         string `json:"device_alias"`
	Distance            int    `json:"distance"`
	Priority            int    `json:"priority"`
	Weight              int    `json:"weight"`
	Enabled             bool   `json:"enabled"`
	Comment             string `json:"comment"`
	Blackhole           bool   `json:"blackhole"`
	DstAddr             string `json:"dstaddr"`          // named address / group
	InternetService     int    `json:"internet_service"` // firewall.internet-service.id
	InternetServiceName string `json:"internet_service_name"`
}

// FGStaticRouteWrite is the simplified write payload → CMDB body.
type FGStaticRouteWrite struct {
	SeqNum          int
	VDOM            string
	DstType         string // subnet | internet-service
	Dst             string // "ip mask"
	Gateway         string
	Device          string
	Distance        *int
	Priority        *int
	Weight          *int
	Status          string // enable | disable
	Comment         string
	Blackhole       bool
	DstAddr         string
	InternetService *int
}

func buildStaticRoutePayload(w FGStaticRouteWrite) map[string]interface{} {
	vdom := w.VDOM
	if vdom == "" {
		vdom = "root"
	}
	p := map[string]interface{}{"vdom": vdom}
	if w.SeqNum > 0 {
		p["seq-num"] = w.SeqNum
	}
	if w.Status != "" {
		p["status"] = w.Status
	}
	p["comment"] = w.Comment
	if w.Distance != nil {
		p["distance"] = *w.Distance
	}
	if w.Priority != nil {
		p["priority"] = *w.Priority
	}
	if w.Weight != nil {
		p["weight"] = *w.Weight
	}

	if w.DstType == "internet-service" {
		if w.InternetService != nil {
			p["internet-service"] = *w.InternetService
		}
		p["gateway"] = w.Gateway
		if w.Device != "" {
			p["device"] = w.Device
		}
		return p
	}

	// Subnet destination (default). A named-address destination overrides "dst".
	if w.DstAddr != "" {
		p["dstaddr"] = w.DstAddr
	} else {
		dst := strings.TrimSpace(w.Dst)
		if dst == "" {
			dst = "0.0.0.0 0.0.0.0"
		}
		p["dst"] = dst
	}
	if w.Blackhole {
		p["blackhole"] = "enable"
		p["device"] = "" // a blackhole route has no egress interface
	} else {
		p["blackhole"] = "disable"
		// Gateway is omitted when empty: a route out a point-to-point tunnel interface
		// has no next-hop gateway (sending gateway:"" makes FortiGate reject it, err -8).
		if strings.TrimSpace(w.Gateway) != "" {
			p["gateway"] = w.Gateway
		}
		if w.Device != "" {
			p["device"] = w.Device
		}
	}
	return p
}

func (f *FortiClient) parseStaticRoute(m map[string]json.RawMessage) FGStaticRoute {
	getStr := func(k string) string {
		if v, ok := m[k]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	getInt := func(k string) int {
		if v, ok := m[k]; ok {
			var i int
			json.Unmarshal(v, &i) //nolint:errcheck
			return i
		}
		return 0
	}
	r := FGStaticRoute{
		SeqNum:          getInt("seq-num"),
		Gateway:         getStr("gateway"),
		Device:          getStr("device"),
		Distance:        getInt("distance"),
		Priority:        getInt("priority"),
		Weight:          getInt("weight"),
		Enabled:         getStr("status") != "disable",
		Comment:         getStr("comment"),
		Blackhole:       FGStringToBool(getStr("blackhole")),
		DstAddr:         getStr("dstaddr"),
		InternetService: getInt("internet-service"),
	}
	if r.InternetService > 0 {
		r.DstType = "internet-service"
	} else {
		r.DstType = "subnet"
		if dst := getStr("dst"); dst != "" {
			r.Dst = FGSubnetToCIDR(dst)
		}
	}
	return r
}

// GetStaticRoutes lists router/static, resolving interface aliases and internet-service
// names for display.
func (f *FortiClient) GetStaticRoutes() ([]FGStaticRoute, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/router/static", nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse static routes: %w", err)
	}

	// alias map (device → alias) from the interface list.
	aliasOf := map[string]string{}
	if ifaces, e := f.GetSystemInterfaces(); e == nil {
		for _, i := range ifaces {
			if i.Alias != "" {
				aliasOf[i.Name] = i.Alias
			}
		}
	}
	isNameCache := map[int]string{}

	out := make([]FGStaticRoute, 0, len(raw))
	for _, m := range raw {
		r := f.parseStaticRoute(m)
		if r.Device != "" {
			r.DeviceAlias = aliasOf[r.Device]
		}
		if r.InternetService > 0 {
			name, ok := isNameCache[r.InternetService]
			if !ok {
				name = f.resolveInternetServiceName(r.InternetService)
				isNameCache[r.InternetService] = name
			}
			r.InternetServiceName = name
		}
		out = append(out, r)
	}
	return out, nil
}

// GetStaticRoute fetches a single route by seq-num for the edit form.
func (f *FortiClient) GetStaticRoute(seq int) (*FGStaticRoute, error) {
	resp, err := f.do("GET", fmt.Sprintf("/api/v2/cmdb/router/static/%d", seq), nil)
	if err != nil {
		return nil, err
	}
	var arr []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &arr); err != nil || len(arr) == 0 {
		return nil, fmt.Errorf("static route %d not found", seq)
	}
	r := f.parseStaticRoute(arr[0])
	if r.InternetService > 0 {
		r.InternetServiceName = f.resolveInternetServiceName(r.InternetService)
	}
	return &r, nil
}

func (f *FortiClient) CreateStaticRoute(w FGStaticRouteWrite) (int, error) {
	payload := buildStaticRoutePayload(w)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] POST router/static payload=%s", b)
	}
	resp, err := f.do("POST", "/api/v2/cmdb/router/static", payload)
	if err != nil {
		return 0, err
	}
	seq := 0
	if resp.MKey != nil {
		switch v := resp.MKey.(type) {
		case float64:
			seq = int(v)
		case int:
			seq = v
		}
	}
	return seq, nil
}

func (f *FortiClient) UpdateStaticRoute(seq int, w FGStaticRouteWrite) error {
	payload := buildStaticRoutePayload(w)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] PUT router/static/%d payload=%s", seq, b)
	}
	_, err := f.do("PUT", fmt.Sprintf("/api/v2/cmdb/router/static/%d", seq), payload)
	return err
}

func (f *FortiClient) DeleteStaticRoute(seq int) error {
	return staticRouteTable.Delete(f, strconv.Itoa(seq))
}

// FGInternetService is one firewall/internet-service entry (id + name) — the datasource
// behind the static route "Internet Service" destination dropdown.
type FGInternetService struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// GetInternetServices returns the full id+name list (~1600 entries) for the dropdown.
func (f *FortiClient) GetInternetServices() ([]FGInternetService, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/internet-service?format=id|name", nil)
	if err != nil {
		return nil, err
	}
	var rows []FGInternetService
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse internet services: %w", err)
	}
	return rows, nil
}

// resolveInternetServiceName looks up a single internet-service name by id (best-effort).
func (f *FortiClient) resolveInternetServiceName(id int) string {
	resp, err := f.do("GET", fmt.Sprintf("/api/v2/cmdb/firewall/internet-service/%d?fields=name", id), nil)
	if err != nil {
		return ""
	}
	var arr []struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(resp.Results, &arr) == nil && len(arr) > 0 {
		return arr[0].Name
	}
	return ""
}
