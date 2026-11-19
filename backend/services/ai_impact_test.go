package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// The impact analysis as a tool FIELD rather than as a headed section of the explanation.
//
// What these tests protect is the reason for the change: the dialog that opens over a live firewall
// shows the model's own account of what applying the config will do, and when that account was
// prose it was recovered with a regex over free text. Any wording the model chose that the regex
// did not expect emptied the section silently, and nothing downstream could tell "the model said
// nothing" from "the model said it in a shape we could not read". As a strict tool field it either
// arrives whole or the request fails loudly.

func TestImpactIsPartOfTheToolSchema(t *testing.T) {
	raw, err := json.Marshal(proposeConfigToolDef().InputSchema)
	if err != nil {
		t.Fatal(err)
	}
	schema := map[string]any{}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatal(err)
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("no properties on the tool schema: %v", schema)
	}
	impact, ok := props["impact"].(map[string]any)
	if !ok {
		t.Fatalf("the tool has no `impact` field — the impact analysis would be back to being prose")
	}
	if impact["type"] != "object" {
		t.Errorf("impact.type = %v, want object", impact["type"])
	}
	// strictInputSchema has to have reached INSIDE it. A strict tool whose nested object lacks
	// additionalProperties is a 400 on every request, not a degraded answer.
	if impact["additionalProperties"] != false {
		t.Error("impact is missing additionalProperties:false — strict mode would 400 the whole request")
	}

	ip, ok := impact["properties"].(map[string]any)
	if !ok {
		t.Fatalf("impact has no properties: %v", impact)
	}
	for _, f := range []string{"subnets", "affected", "placement"} {
		if _, present := ip[f]; !present {
			t.Errorf("impact.%s is missing", f)
		}
	}
	for _, f := range []string{"subnets", "affected"} {
		sub, _ := ip[f].(map[string]any)
		if sub["type"] != "array" {
			t.Errorf("impact.%s.type = %v, want array", f, sub["type"])
		}
	}
	if pl, _ := ip["placement"].(map[string]any); pl["type"] != "string" {
		t.Errorf("impact.placement.type = %v, want string", pl["type"])
	}

	req, _ := impact["required"].([]any)
	if len(req) != 3 {
		t.Errorf("impact.required = %v, want all three fields — a half-filled impact is the "+
			"failure this change exists to remove", impact["required"])
	}

	// …but impact must NOT be required at the ROOT: a query-mode answer changes nothing and has no
	// impact to state, and requiring it would make the model invent one.
	rootReq, _ := schema["required"].([]any)
	for _, r := range rootReq {
		if r == "impact" {
			t.Error("impact must not be in the root required list — query answers have no impact")
		}
	}
}

// The field has to survive the round trip the product actually makes: the model's JSON → the
// ConfigSuggestion the controller serialises → the browser.
func TestImpactSurvivesTheWire(t *testing.T) {
	in := []byte(`{"mode":"config","commands":["config firewall address"],"explanation":"ok",
		"impact":{"subnets":["192.168.10.0/24"],"affected":["every host on the office LAN"],
		"placement":"above Allow-LAN-Internet, or it is shadowed"}}`)

	var s ConfigSuggestion
	if err := json.Unmarshal(in, &s); err != nil {
		t.Fatal(err)
	}
	if s.Impact == nil {
		t.Fatal("impact was dropped on the way in")
	}
	if len(s.Impact.Subnets) != 1 || s.Impact.Subnets[0] != "192.168.10.0/24" {
		t.Errorf("subnets = %v", s.Impact.Subnets)
	}
	if !strings.Contains(s.Impact.Placement, "shadowed") {
		t.Errorf("placement = %q", s.Impact.Placement)
	}

	out, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"impact":{`) {
		t.Errorf("impact was not serialised back out:\n%s", out)
	}

	// A query answer carries none, and `omitempty` must keep the key out rather than send a null
	// the frontend then has to guard.
	q := ConfigSuggestion{Mode: "query", Commands: []string{}, Explanation: "hello"}
	qo, _ := json.Marshal(q)
	if strings.Contains(string(qo), "impact") {
		t.Errorf("a query answer should carry no impact key:\n%s", qo)
	}
}

// The prompt has to ASK for the field, and — just as important — stop asking for the prose section
// it replaced. Two copies of the same three bullets is the user reading them twice.
func TestPromptAsksForTheImpactFieldAndNotTheProseSection(t *testing.T) {
	for _, want := range []string{
		"impact.subnets",
		"impact.affected",
		"impact.placement",
		`MUST fill the tool's "impact" field`,
	} {
		if !strings.Contains(objectReuseConditions, want) {
			t.Errorf("the impact rules no longer mention %q", want)
		}
	}
	p := staticSystemPrompt(platformPrompts["fortinet"])
	if !strings.Contains(p, "The impact analysis does NOT go in the explanation") {
		t.Error("the explanation budget must send the impact to the tool field, not to the prose")
	}
	// The old instruction, verbatim. If it comes back, the model writes the section AND fills the
	// field, and the chat shows the same three lines twice.
	if strings.Contains(p, `end EVERY config explanation with a section titled`) {
		t.Error("the prompt still asks for the impact as a headed section of the explanation")
	}
}
