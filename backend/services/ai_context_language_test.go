package services

import (
	"strings"
	"testing"
)

// The bug this file pins: a prompt written in Thai produced ZERO candidate words, because the
// matcher kept [a-z0-9] only. The caller read "no candidates" as "this device has no such
// application", so the model was told to refuse — and Thai is this product's main language. An
// ordinary request like "บล็อกเฟสบุ๊คตอนกลางคืน" was answered with "Application Control cannot see
// this app on this device", about a firewall holding 2,414 signatures including Facebook's.

func sampleApps() []AppSignatureMeta {
	return []AppSignatureMeta{
		{ID: 15832, Name: "Facebook_Video.Play", Category: 23, Risk: 3, Popularity: 5},
		{ID: 15831, Name: "Facebook", Category: 23, Risk: 3, Popularity: 5},
		{ID: 31077, Name: "YouTube_Video.Play", Category: 5, Risk: 2, Popularity: 5},
		{ID: 41540, Name: "LINE", Category: 21, Risk: 2, Popularity: 4},
		{ID: 50001, Name: "Steam", Category: 8, Risk: 2, Popularity: 3},
		{ID: 60001, Name: "Zoom", Category: 21, Risk: 1, Popularity: 4},
	}
}

func TestThaiPromptFindsTheSignature(t *testing.T) {
	cases := []struct {
		name   string
		prompt string
		wantID int
	}{
		{"Thai, no spaces, the word buried mid-sentence", "บล็อกเฟสบุ๊คตอนกลางคืน", 15831},
		{"a different transliteration of the same app", "ห้ามใช้เฟซบุ๊กในเวลางาน", 15831},
		{"Thai for YouTube", "ปิดยูทูบให้หน่อย", 31077},
		{"another common spelling of YouTube", "บล็อกยูทูปด้วย", 31077},
		{"LINE, which is also an English word", "บล็อกไลน์", 41540},
		{"Chinese", "封锁微信和抖音", 0}, // neither is in sampleApps; see the assertion below
		{"English still works", "block facebook", 15831},
		{"mixed Thai and English", "ช่วยบล็อก youtube ให้หน่อย", 31077},
	}

	apps := sampleApps()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			matched, unmatched := matchAppSignatures(apps, c.prompt)
			if c.wantID == 0 {
				// The words were recognised as app names even though this device has no signature
				// for them — which is the honest answer, and NOT the same as having no words.
				if len(unmatched) == 0 {
					t.Fatalf("no candidate words came out of %q — the prompt would be reported as "+
						"naming no application at all", c.prompt)
				}
				return
			}
			found := false
			for _, m := range matched {
				if m.ID == c.wantID {
					found = true
				}
			}
			if !found {
				t.Errorf("%q did not match signature %d; got %d matches, unmatched=%v",
					c.prompt, c.wantID, len(matched), unmatched)
			}
		})
	}
}

// A prompt that names no application must come back with NO candidate words, so the caller can
// tell "you did not ask about applications" from "this device has no such app".
func TestAPromptAboutSomethingElseNamesNoApp(t *testing.T) {
	apps := sampleApps()
	for _, prompt := range []string{
		"สร้าง policy จาก LAN ไป WAN",
		"สวัสดีครับ",
		"create an address object for 10.0.0.0/24",
	} {
		matched, unmatched := matchAppSignatures(apps, prompt)
		if len(matched) != 0 {
			t.Errorf("%q matched %d signatures; it names no application", prompt, len(matched))
		}
		for _, w := range unmatched {
			// "policy", "address", "object" and the like are stop words or simply miss; what must
			// NOT happen is an app alias firing on an unrelated sentence.
			if w == "facebook" || w == "youtube" || w == "line" {
				t.Errorf("%q produced the app candidate %q out of nowhere", prompt, w)
			}
		}
	}
}

// aliasCandidates feeds the cached half of the system prompt. Go randomises map iteration, so an
// unsorted result would make the same question produce a different prompt on every request and the
// prompt cache would never hit.
func TestAliasCandidatesAreDeterministic(t *testing.T) {
	const prompt = "บล็อกเฟสบุ๊ค ยูทูบ ไลน์ และซูม"
	first := strings.Join(aliasCandidates(prompt), ",")
	for i := 0; i < 20; i++ {
		if got := strings.Join(aliasCandidates(prompt), ","); got != first {
			t.Fatalf("aliasCandidates is not stable: %q then %q", first, got)
		}
	}
	if first == "" {
		t.Fatal("a prompt naming four apps in Thai produced no candidates")
	}
}

// A quoted span is an object NAME the user is choosing, not an app to match — the existing rule,
// which has to keep holding for the alias path too, or naming a profile "โซเชียล-block" would pull
// every social signature into the request.
func TestQuotedThaiIsNotTreatedAsAnApp(t *testing.T) {
	got := aliasCandidates(`create a sensor named "เฟสบุ๊ค-block" for general use`)
	for _, w := range got {
		if w == "facebook" {
			t.Error("a quoted object name was matched as an application")
		}
	}
}
