package services

import "sync"

// Parallel runs independent FortiGate reads at the same time and waits for all of them.
//
// Why this exists: a FortiGate page rarely needs one object type. The Firewall Policy form needs
// fourteen name lists, the Audit report needs the policy table plus every object it references,
// and each of those is its own HTTPS GET. Issued one after another they add up — a warm pooled
// call is ~0.04-0.06s against the lab FGT80E, so fourteen of them is most of a second in which
// nothing but waiting happens. Issued together they cost about as much as the slowest one.
//
// Three properties the callers rely on:
//
//   - It is safe. A *FortiClient wraps an http.Client with a cookie jar, both of which are
//     documented goroutine-safe, and its own mutable state (the CSRF token, the stored
//     credentials) is behind a RWMutex. The device allows concurrent admin sessions
//     (`admin-concurrent enable`) and these all share ONE pooled session anyway.
//   - It does not change the result. Each function writes to its own variable and the caller
//     assembles the response afterwards, so the output is identical to the sequential version
//     whatever order the goroutines finish in. That matters most for the AI prompt, which is
//     cached by content.
//   - It does not swallow failures. Every caller here already treats a failed section as "no
//     data" (the FortiGate form degrades to an empty picker rather than a broken page), so the
//     functions keep their own error handling instead of this helper imposing one.
//
// The work is I/O-bound on one device, so there is no worker limit: fourteen goroutines parked in
// a socket read cost nothing, and capping them would only re-introduce the serialisation.
func Parallel(fns ...func()) {
	if len(fns) == 0 {
		return
	}
	// One call is the common case for a device with a single section; running it inline skips
	// the goroutine and the WaitGroup entirely.
	if len(fns) == 1 {
		fns[0]()
		return
	}

	var wg sync.WaitGroup
	wg.Add(len(fns))
	for _, fn := range fns {
		go func(fn func()) {
			defer wg.Done()
			fn()
		}(fn)
	}
	wg.Wait()
}
