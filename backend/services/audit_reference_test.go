package services

import (
	"strings"
	"testing"
)

// The reference layer quotes a standards body on a compliance page. Everything that can go wrong
// with that is silent: a citation pointing at a control the generator never fetched renders an
// empty box, a correspondence added without a reason renders a quotation with no basis, and a row
// that loses its provenance renders NIST's words with nothing saying they are NIST's.

func TestEveryCitedNISTControlWasGenerated(t *testing.T) {
	// The catalogue is an embedded JSON asset now, so "the file is there and parses" is a thing
	// that can fail on its own — and it would fail as an empty panel with no error anywhere.
	if n := nistControlCount(); n == 0 {
		t.Fatal("services/nist_sp800_53.json parsed to no controls at all")
	}

	// The correspondence table and services/gen/extract_oscal.py must agree. This is the failure
	// that produces an empty panel on screen and no error anywhere.
	for _, id := range referencedNISTIDs() {
		ctrl, ok := nistControl(id)
		if !ok {
			t.Errorf("the correspondence cites %s, which is not in services/nist_sp800_53.json — add it to WANTED in services/gen/extract_oscal.py and re-run the generator", id)
			continue
		}
		if strings.TrimSpace(ctrl.Statement) == "" {
			t.Errorf("%s was generated with an empty statement", id)
		}
		if strings.TrimSpace(ctrl.Title) == "" {
			t.Errorf("%s was generated with no title", id)
		}
	}
}

func TestReferenceTablesAgreeWithEachOther(t *testing.T) {
	// isoReference carries the prose, referenceIDs carries the ids. Two tables keyed the same way
	// drift the moment one is edited alone.
	for id := range isoReference {
		if len(referenceIDs[id]) == 0 {
			t.Errorf("%s has a reason but no SP 800-53 controls — the page would render a basis for nothing", id)
		}
	}
	for id := range referenceIDs {
		if _, ok := isoReference[id]; !ok {
			t.Errorf("%s cites SP 800-53 controls but gives no reason for the correspondence", id)
		}
	}
}

func TestEveryReferencedControlIsInTheUniverse(t *testing.T) {
	known := map[string]bool{}
	for _, def := range controlUniverse {
		known[def.ID] = true
	}
	for id := range referenceIDs {
		if !known[id] {
			t.Errorf("the reference table describes %q, which is not a control this console assesses", id)
		}
	}
}

// Every control on the page should have reading material, or the page is back to showing an id and
// a status and expecting the reader to know the standard. A new control added to the universe
// without one fails here rather than shipping as a blank row.
func TestEveryAssessableControlHasReadingMaterial(t *testing.T) {
	cat := BuildReferenceCatalogue()
	for _, def := range controlUniverse {
		if _, ok := cat.References[def.ID]; !ok {
			t.Errorf("%s (%s) has no public-domain reference — add one to audit_reference.go, or record here why no honest correspondence exists", def.ID, def.Title)
		}
	}
}

func TestEveryCorrespondenceStatesItsBasis(t *testing.T) {
	for id, ref := range isoReference {
		if strings.TrimSpace(ref.Why) == "" {
			t.Errorf("%s cites SP 800-53 with no stated basis — an unexplained correspondence next to a real control number is exactly what this layer exists to avoid", id)
		}
	}
}

// The provenance travels with the data, because the UI must not be the only thing that knows whose
// words these are.
func TestReferenceCatalogueCarriesItsProvenance(t *testing.T) {
	cat := BuildReferenceCatalogue()

	if !cat.Source.Doc.PublicDomain {
		t.Error("the quoted source must be marked public domain — it is the only reason it may be quoted")
	}
	if cat.Source.Version == "" {
		t.Error("no catalogue version: a quotation from an unnamed release cannot be checked")
	}
	if cat.Source.Doc.URL == "" {
		t.Error("the quoted source has no URL, so a reader cannot go and verify it")
	}
	if cat.Authoritative.PublicDomain {
		t.Error("ISO/IEC 27001 must never be marked public domain — that flag is what governs whether text may be reproduced")
	}
	if cat.Authoritative.URL == "" {
		t.Error("no link to the authoritative standard, which is where a reader goes for the words we may not print")
	}
	for _, want := range []string{"NIST", "not a mapping published", "ISO/IEC"} {
		if !strings.Contains(cat.Source.Note, want) {
			t.Errorf("the provenance note does not mention %q — it has to say whose words these are AND whose the correspondence is", want)
		}
	}
}

func TestReferencesAreBuiltWithText(t *testing.T) {
	cat := BuildReferenceCatalogue()
	for id, ref := range cat.References {
		if len(ref.Controls) == 0 {
			t.Errorf("%s resolved to no controls", id)
		}
		if ref.ControlID != id {
			t.Errorf("%s carries control id %q", id, ref.ControlID)
		}
		if ref.FrameworkID != FrameworkISO27k {
			t.Errorf("%s carries framework %q", id, ref.FrameworkID)
		}
		for _, c := range ref.Controls {
			if strings.TrimSpace(c.Statement) == "" {
				t.Errorf("%s cites %s with no statement text", id, c.ID)
			}
		}
	}
}

func TestReferenceForControl(t *testing.T) {
	if ref := referenceForControl("A.8.17"); ref == nil {
		t.Fatal("A.8.17 has no reference")
	} else if len(ref.Controls) == 0 || ref.Controls[0].ID != "AU-8" {
		t.Errorf("A.8.17 (Clock synchronization) should cite AU-8 Time Stamps first, got %+v", ref.Controls)
	}
	if ref := referenceForControl("A.9.99"); ref != nil {
		t.Error("a control that does not exist returned a reference")
	}
}
