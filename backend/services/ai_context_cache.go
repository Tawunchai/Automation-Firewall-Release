// Package services - AI Assistant: converts plain-language requests into FortiOS CLI commands
// using the Anthropic Claude API (FortiGate / FortiOS only).
package services

import (
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"network_automation/entity"
)

// The live-context snapshot cache: how often the AI Assistant reads the firewall.
//
// buildDeviceSnapshot (ai_context.go) fires sixteen concurrent CMDB reads plus the
// application-signature database, and it ran on EVERY prompt — including "สวัสดี". A greeting cost
// the device seventeen reads and the user a second of waiting for a snapshot the answer never
// used, and a four-turn conversation about one policy read the whole inventory four times.
//
// So the device half is cached for a minute per (device, account). Not an intent gate: guessing
// from the words whether a prompt needs the inventory is exactly the misjudgement that produces a
// duplicate address object, and the cost of being wrong is asymmetric — a wasted read is cheap, a
// wrong proposal is not.
//
// What is NOT cached is the part that depends on the prompt: the Application Control section
// carries only the signature ids this prompt matched (appControlContext). It is recomputed from the
// cached signature database on every request, so the rendered text stays byte-identical to the
// uncached version — which matters because the assembled context goes into a prompt-cached block
// and any reordering would cost a cache miss.
//
// Freshness: a minute is short enough that a change made on the firewall's own GUI shows up in the
// next conversation, and any write through THIS console invalidates the entry immediately (the
// change recorder calls InvalidateLiveDeviceContext), so "apply, then ask a follow-up" sees the
// object that was just created rather than proposing it a second time for a -5.
const liveContextTTL = 60 * time.Second

// liveContextSnapshot is the prompt-INDEPENDENT half of the live context, held in the three pieces
// the assembly order needs: the truncated object inventory, the sections appended after it, and the
// sections that follow the prompt-dependent Application Control block.
type liveContextSnapshot struct {
	head  string // interfaces + addresses + services + profile names + policy names (truncated)
	mid   string // schedules + routes + VIPs
	tail  string // existing app lists + web/DNS filter + file filter + users + auth servers + SD-WAN
	facts *deviceFacts
	at    time.Time
}

var liveContextCache sync.Map // string key → *liveContextSnapshot

func liveContextKey(deviceID uint, username string) string {
	return strconv.FormatUint(uint64(deviceID), 10) + "|" + username
}

// InvalidateLiveDeviceContext drops every cached snapshot of one device, for all accounts.
//
// Called by the change recorder after any device-proxy write. All accounts, not just the one that
// wrote: two operators in one conversation each have their own cache key, and the object the first
// one created is on the device for both of them.
func InvalidateLiveDeviceContext(deviceID uint) {
	prefix := strconv.FormatUint(uint64(deviceID), 10) + "|"
	liveContextCache.Range(func(k, _ any) bool {
		if s, ok := k.(string); ok && strings.HasPrefix(s, prefix) {
			liveContextCache.Delete(k)
		}
		return true
	})
}

// renderLiveContext assembles a snapshot plus this prompt's Application Control section. The
// concatenation order is the one buildDeviceSnapshot's comments describe and must not change.
func renderLiveContext(s *liveContextSnapshot, prompt string) (string, *deviceFacts) {
	appCtx := ""
	if s.facts != nil {
		appCtx = appControlContext(s.facts.appMeta, prompt)
	}
	return s.head + s.mid + appCtx + s.tail, s.facts
}

func buildLiveDeviceContext(device *entity.NetworkDevice, login DeviceLogin, prompt string) (string, *deviceFacts) {
	key := liveContextKey(device.ID, login.Username)
	if v, ok := liveContextCache.Load(key); ok {
		if snap, ok := v.(*liveContextSnapshot); ok && time.Since(snap.at) < liveContextTTL {
			// Logged because "the AI did not see the object I just created" is the only way this
			// cache can be wrong, and the first question then is whether it served a snapshot at
			// all. One line per request, with its age.
			log.Printf("[ai] live device context: cached snapshot for device %d (%.0fs old)",
				device.ID, time.Since(snap.at).Seconds())
			return renderLiveContext(snap, prompt)
		}
	}
	snap := buildDeviceSnapshot(device, login)
	if snap == nil {
		return "", nil
	}
	liveContextCache.Store(key, snap)
	return renderLiveContext(snap, prompt)
}
