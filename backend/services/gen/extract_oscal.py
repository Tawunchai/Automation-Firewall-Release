#!/usr/bin/env python3
"""Generate services/nist_sp800_53.json from NIST's OSCAL catalogue.

WHY THIS IS GENERATED AND NOT TYPED. The Audit page needs to say what a control asks
for in words a reader can check, and the words of ISO/IEC 27001 are copyright ISO/IEC
and may not be reproduced. NIST SP 800-53 Rev 5 is a work of the United States
Government, is in the public domain, and NIST publishes it as machine-readable OSCAL.
So the explanation text on that page is NIST's, quoted exactly.

"Exactly" is the whole point, and it is why this is a script rather than a paste. Text
retyped by a person is text that can drift a word, and a drifted quotation attributed
to a standards body is worse than no quotation at all. Every string in the generated
file comes out of the catalogue below, byte for byte, apart from the parameter
placeholders, which are rendered in NIST's own printed convention (see resolve()).

Re-run:

    python backend/services/gen/extract_oscal.py

It fetches the catalogue, so it needs the network. It writes only
services/nist_sp800_53.json — the asset services/audit_reference_data.go embeds — and
prints a summary; if the upstream file moves it fails loudly rather than emitting a
half-catalogue.

It used to emit Go: 165 lines holding 58 KB of NIST's prose in string literals, which
line-counted as one of the smallest files in the package and so sat outside every size
budget this repo keeps. Same bytes, as data.
"""

import json
import os
import re
import sys
import urllib.request

CATALOG_URL = (
    "https://raw.githubusercontent.com/usnistgov/oscal-content/main/"
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json"
)

# The controls the audit catalogue cites. Keep in step with isoReference in
# services/audit_reference.go — a test fails if the two disagree.
WANTED = [
    "ac-2", "ac-4", "ac-6", "ac-7", "ac-17",
    "au-2", "au-3", "au-6", "au-8", "au-9", "au-12",
    "cm-2", "cm-3", "cm-6", "cm-7",
    "ia-2", "ia-5",
    "ra-5",
    "sc-7", "sc-8", "sc-13",
    "si-2", "si-3", "si-4",
]

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "nist_sp800_53.json")


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def walk(node):
    for c in node.get("controls", []) or []:
        yield c
        for sub in walk(c):
            yield sub
    for g in node.get("groups", []) or []:
        for c in walk(g):
            yield c


def label(ctrl):
    """The printed control id — "AU-8", not the OSCAL slug."""
    for p in ctrl.get("props", []):
        if p.get("name") == "label" and "class" not in p:
            return p["value"]
    return ctrl["id"].upper()


def build_params(ctrl):
    """id -> the text NIST prints where the placeholder sits."""
    out = {}
    for p in ctrl.get("params", []) or []:
        lab = p.get("label")
        if lab:
            out[p["id"]] = "[Assignment: organization-defined %s]" % lab
            continue
        sel = p.get("select")
        if sel:
            choices = [c if isinstance(c, str) else c.get("value", "") for c in sel.get("choice", [])]
            how = sel.get("how-many", "one")
            word = "one or more" if how == "one-or-more" else "one"
            out[p["id"]] = "[Selection (%s): %s]" % (word, "; ".join(choices))
        for alt in p.get("props", []) or []:
            if alt.get("name") == "alt-identifier" and p["id"] in out:
                out[alt["value"]] = out[p["id"]]
    return out


PARAM_RE = re.compile(r"\{\{\s*insert:\s*param,\s*([^}\s]+)\s*\}\}")


def resolve(prose, params):
    return PARAM_RE.sub(lambda m: params.get(m.group(1), m.group(0)), prose or "")


def statement(ctrl, params):
    """The control statement, flattened to numbered lines the way NIST prints it."""
    lines = []

    def emit(part, depth):
        if part.get("name") not in ("statement", "item"):
            return
        mark = ""
        for p in part.get("props", []) or []:
            if p.get("name") == "label":
                mark = p["value"]
        prose = resolve(part.get("prose"), params).strip()
        if prose:
            lines.append(("  " * depth) + (mark + " " if mark else "") + prose)
        for sub in part.get("parts", []) or []:
            emit(sub, depth + (1 if prose or mark else 0))

    for part in ctrl.get("parts", []) or []:
        if part.get("name") == "statement":
            emit(part, 0)
    return "\n".join(lines).strip()


def guidance(ctrl, params):
    for part in ctrl.get("parts", []) or []:
        if part.get("name") == "guidance":
            return resolve(part.get("prose"), params).strip()
    return ""


def main():
    print("fetching %s" % CATALOG_URL, file=sys.stderr)
    doc = fetch(CATALOG_URL)
    cat = doc["catalog"]
    meta = cat["metadata"]
    index = {}
    for g in cat.get("groups", []) or []:
        for c in walk(g):
            index[c["id"]] = c

    missing = [w for w in WANTED if w not in index]
    if missing:
        sys.exit("catalogue does not contain: %s" % ", ".join(missing))

    rows = []
    for slug in WANTED:
        c = index[slug]
        params = build_params(c)
        rows.append({
            "slug": slug,
            "id": label(c),
            "title": c["title"],
            "statement": statement(c, params),
            "guidance": guidance(c, params),
        })

    version = meta.get("version", "")
    out = {
        "version": version,
        # NIST's own words, unedited. See the module docstring for why this is a fetch and not
        # a paste, and services/audit_reference.go for why it is NIST and not ISO.
        "source": CATALOG_URL,
        "last_modified": meta.get("last-modified", ""),
        "controls": {
            r["id"]: {
                "id": r["id"],
                "title": r["title"],
                "statement": r["statement"],
                "guidance": r["guidance"],
            }
            for r in rows
        },
    }

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    print("wrote %s (%d controls)" % (os.path.normpath(OUT), len(rows)), file=sys.stderr)


if __name__ == "__main__":
    main()
