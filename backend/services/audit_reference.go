package services

import "sort"

// ── What a control actually asks for, in words a reader may read ─────────────
//
// THE PROBLEM THIS SOLVES. The ISO/IEC 27001 tab listed a control id, a control name, a status and
// the slugs of the checks behind it:
//
//	A.8.2   Privileged access rights   Gap found   direct   from admin-unrestricted — 1 finding
//
// Everything on that line is true and none of it tells a reader what A.8.2 REQUIRES. Somebody
// preparing for an assessment has to leave the page to find that out, and somebody who does not
// know the standard cannot tell whether our finding is a fair reading of it.
//
// WHY THE OBVIOUS FIX IS ILLEGAL. The obvious fix is to print the control's text. ISO/IEC 27001's
// text is copyright ISO/IEC; reproducing it inside a product needs a licence this repository does
// not have. That rule is why audit_control_universe.go carries control NAMES and nothing else, and
// it is not negotiable.
//
// WHY THE NEXT-MOST-OBVIOUS FIX IS WORSE. Writing our own paragraph explaining what A.8.2 is about
// puts a sentence nobody can check next to a real control number, in a product whose entire pitch
// on this page is that it never does that. TitleSource exists in audit_standards.go for exactly
// this reason.
//
// WHAT THIS FILE DOES INSTEAD. NIST Special Publication 800-53 Revision 5 is a publication of the
// United States Government. Its text is not subject to copyright, NIST publishes it as
// machine-readable OSCAL, and it covers the same subject matter: access control, logging, boundary
// protection, configuration management. So the page can show, beside an Annex A control, the
// SP 800-53 control that expresses the same requirement — QUOTED EXACTLY, extracted by a script
// (services/gen/extract_oscal.py) so that not one word of it passes through a person's keyboard.
//
// THE HONEST SPLIT, AND IT IS THE WHOLE POINT:
//
//	the correspondence below   OURS.    An interpretation, marked as one, same as every other
//	                                    mapping in this layer.
//	the text it points at      NIST's.  Public domain, verbatim, with the release it came from.
//	ISO/IEC 27001's own text   ABSENT.  It is not here, it is not paraphrased here, and the page
//	                                    links to ISO for anyone who needs the authoritative wording.
//
// A reader can therefore disagree with us about the correspondence — which is a thing they can
// check — without ever being handed a sentence about a standard that nobody can trace.

// NISTControl is one SP 800-53 control, as published. Both text fields are NIST's own words; see
// audit_reference_data.go, which is generated and must not be edited.
type NISTControl struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Statement is the control itself — the "the organization shall" part.
	Statement string `json:"statement"`
	// Guidance is NIST's discussion of it. Longer, and the part that usually answers "but what
	// does that mean for a firewall?".
	Guidance string `json:"guidance"`
}

// ControlReference is the public-domain reading material for one Annex A control.
type ControlReference struct {
	FrameworkID string `json:"framework_id"`
	ControlID   string `json:"control_id"`
	// Controls are the SP 800-53 controls this console considers to express the same requirement.
	Controls []NISTControl `json:"controls"`
	// Why is OURS: one line on the basis for the correspondence. It says why these controls, not
	// what the ISO control says — that distinction is the reason this field is safe to write.
	Why string `json:"why"`
	// Partial marks a correspondence that covers part of the Annex A control and not all of it.
	// Stated rather than smoothed over: a reader who takes SC-7 as the whole of "Networks security"
	// has been misled by us, not by NIST.
	Partial bool `json:"partial,omitempty"`
}

// ReferenceSource is the provenance shown above the quotations.
type ReferenceSource struct {
	Doc ReferenceDoc `json:"doc"`
	// Version of the catalogue the quotations were taken from.
	Version string `json:"version"`
	// Note is the standing disclaimer. It travels with the data so the UI and the evidence PDF
	// cannot state the provenance two different ways.
	Note string `json:"note"`
}

// ReferenceCatalogue is everything the reference endpoint returns.
type ReferenceCatalogue struct {
	Source ReferenceSource `json:"source"`
	// Authoritative is where the reader goes for the words this console may not print.
	Authoritative ReferenceDoc                `json:"authoritative"`
	References    map[string]ControlReference `json:"references"`
}

var docNIST80053 = ReferenceDoc{
	ID:        "NIST SP 800-53 Rev. 5",
	Title:     "Security and Privacy Controls for Information Systems and Organizations",
	Publisher: "National Institute of Standards and Technology",
	URL:       "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
	// The one source in this repository whose text may be reproduced, and the reason this whole
	// file is possible.
	PublicDomain: true,
}

// isoReference is the correspondence: Annex A control → the SP 800-53 controls that state the same
// requirement in publishable words.
//
// EVERY ROW IS AN INTERPRETATION and is presented as one. The rule for adding a row is the same as
// the rule for a control mapping next door: it goes in when the two controls are about the same
// thing, and it is marked Partial when the SP 800-53 side is narrower than the Annex A side. Where
// no honest correspondence exists, the row is simply absent — the UI then shows the ISO title and
// the link to ISO, which is the truthful outcome and better than a stretched analogy.
//
// The ids here and the WANTED list in services/gen/extract_oscal.py must agree. A test enforces it,
// so a row added without regenerating the data fails the build rather than rendering an empty box.
var isoReference = map[string]ControlReference{
	"A.8.2": {
		Why: "Both are about who holds elevated rights on the system and from where those rights may be used.",
	},
	"A.8.5": {
		Why: "Both are about proving who an administrator is before the system obeys them, and about what happens when that proof keeps failing.",
	},
	"A.8.7": {
		Why: "Both are about detecting and stopping malicious code at the points traffic enters the organisation.",
	},
	"A.8.8": {
		Why: "Both are about knowing which published weaknesses apply to the running software and acting on them.",
	},
	"A.8.9": {
		Why: "Both are about a known-good recorded state for the device and the settings that keep it there.",
	},
	"A.8.15": {
		Why: "Both are about which events are recorded, what each record contains, and whether the record can be tampered with afterwards.",
	},
	"A.8.16": {
		Why: "Both are about someone or something actually looking at what the system reports, rather than only collecting it.",
	},
	"A.8.17": {
		Why: "Both are about timestamps that can be lined up against another system's — the property that makes an incident reconstructable.",
	},
	"A.8.20": {
		Why:     "Both are about controlling what may cross the boundary between networks of different trust.",
		Partial: true,
	},
	"A.8.21": {
		Why:     "Both are about the security properties a network service is required to provide before it is relied on.",
		Partial: true,
	},
	"A.8.22": {
		Why: "Both are about keeping groups of systems apart and enforcing what may flow between them.",
	},
	"A.8.23": {
		Why:     "SP 800-53 has no control named for web filtering; these two cover the part of it a firewall performs — restricting which external services a user may reach.",
		Partial: true,
	},
	"A.8.24": {
		Why: "Both are about applying cryptography where information would otherwise be exposed in transit.",
	},
	"A.8.32": {
		Why: "Both are about changes being proposed, approved and recorded rather than simply made.",
	},
}

// referenceIDs is the correspondence itself, kept beside the prose above rather than inside it so
// that the ids — the part the generator and the tests care about — read as one table.
var referenceIDs = map[string][]string{
	"A.8.2":  {"AC-6", "AC-2", "AC-17"},
	"A.8.5":  {"IA-2", "IA-5", "AC-7"},
	"A.8.7":  {"SI-3"},
	"A.8.8":  {"RA-5", "SI-2"},
	"A.8.9":  {"CM-2", "CM-6"},
	"A.8.15": {"AU-2", "AU-3", "AU-12", "AU-9"},
	"A.8.16": {"SI-4", "AU-6"},
	"A.8.17": {"AU-8"},
	"A.8.20": {"SC-7"},
	"A.8.21": {"SC-7", "SC-8"},
	"A.8.22": {"SC-7", "AC-4"},
	"A.8.23": {"SC-7", "CM-7"},
	"A.8.24": {"SC-13", "SC-8"},
	"A.8.32": {"CM-3"},
}

// referenceNote is the sentence that must appear wherever these quotations do.
const referenceNote = "The text below is quoted from NIST SP 800-53 Rev. 5, a publication of the " +
	"United States Government and not subject to copyright. Which SP 800-53 control corresponds to " +
	"which ISO/IEC 27001 Annex A control is this console's own reading, not a mapping published by " +
	"either body. ISO/IEC 27001's own text is copyright ISO/IEC and is not reproduced anywhere in " +
	"this product — follow the ISO link for the authoritative wording."

// BuildReferenceCatalogue returns the reading material for every control that has any.
//
// It is static: no device is read, no scan is needed, and the same bytes come back for every
// caller. That is why it has its own endpoint rather than riding along on the audit report, which
// is already large and is per-device.
func BuildReferenceCatalogue() ReferenceCatalogue {
	out := ReferenceCatalogue{
		Source: ReferenceSource{
			Doc: docNIST80053, Version: NISTCatalogueVersion(), Note: referenceNote,
		},
		Authoritative: docISO27001,
		References:    map[string]ControlReference{},
	}
	for id, ref := range isoReference {
		ids := referenceIDs[id]
		if len(ids) == 0 {
			continue
		}
		built := ControlReference{
			FrameworkID: FrameworkISO27k, ControlID: id, Why: ref.Why, Partial: ref.Partial,
		}
		for _, nid := range ids {
			if ctrl, ok := nistControl(nid); ok {
				built.Controls = append(built.Controls, ctrl)
			}
		}
		if len(built.Controls) == 0 {
			continue
		}
		out.References[id] = built
	}
	return out
}

// referenceForControl returns the reading material for one control, or nil when there is none.
func referenceForControl(controlID string) *ControlReference {
	cat := BuildReferenceCatalogue()
	if ref, ok := cat.References[controlID]; ok {
		return &ref
	}
	return nil
}

// referencedNISTIDs is every SP 800-53 id the correspondence cites, deduplicated and sorted.
// The generator's WANTED list must contain all of them; a test asserts it.
func referencedNISTIDs() []string {
	seen := map[string]bool{}
	var out []string
	for _, ids := range referenceIDs {
		for _, id := range ids {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	sort.Strings(out)
	return out
}
