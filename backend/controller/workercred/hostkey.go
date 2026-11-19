package workercred

import (
	"errors"
	"net"
	"net/http"
	"strconv"

	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
)

// CheckHostKey is how the Python worker reaches the one store of pinned SSH host keys.
//
// POST /internal/ssh-host-key
//
// ── Why the worker does not decide this for itself ───────────────────────────
//
// netmiko connected with no host-key checking at all, which means every scheduled backup and every
// config push handed a firewall administrator's password to whatever answered on port 22. The Go
// side has refused that since Phase 2 (services/sshhostkey.go), and the obvious fix for the worker
// — a known_hosts file on a volume — would have given this system TWO sets of pins that can
// disagree: a firewall "known" to the console and unknown to the worker, each learning its own
// first key, possibly from different connections. So the worker measures the key and asks here.
//
// ── Why it is safe for the worker to measure it ──────────────────────────────
//
// The fingerprint in the request is asserted by the worker, which is already trusted with the
// shared secret and with the credentials it is about to use. What it is NOT trusted with is the
// decision: the verdict, and the expected fingerprint on a mismatch, come from the database here.
// And because the worker reads the key on a connection that sends no credentials before verifying
// it against this answer (worker/host_keys.py), being wrong costs nothing but a failed job.
// hostKeyAddr spells "host:port" the way every SSH dial in this application spells it.
//
// It is its own function so that it can be tested against the one thing that matters about it: the
// stored pin is keyed on the address AS DIALLED by services/fortigate_ssh.go and
// services/terminal.go, both of which use net.JoinHostPort. A different spelling here — notably
// fmt.Sprintf("%s:%d", …), which does not bracket an IPv6 literal — would pin the same firewall a
// second time under a second name, and then no connection would ever be checked against the
// other's key.
func hostKeyAddr(host string, port int) string {
	if port <= 0 {
		port = 22 // the same default netmiko applies when the job message carries no port
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func CheckHostKey(c *gin.Context) {
	if !platform.WorkerAuthOK(c.GetHeader("X-Worker-Secret")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid worker secret"})
		return
	}

	var inp struct {
		Host        string `json:"host"`
		Port        int    `json:"port"`
		KeyType     string `json:"key_type"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a host, port and fingerprint are required"})
		return
	}
	if inp.Host == "" || inp.Fingerprint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a host, port and fingerprint are required"})
		return
	}

	hostport := hostKeyAddr(inp.Host, inp.Port)

	verdict, expected, err := platform.CheckOrPinFingerprint(hostport, inp.KeyType, inp.Fingerprint)
	if errors.Is(err, platform.ErrHostKeyStoreUnset) {
		// 503, not 500: the worker should fail the job and say the console is misconfigured, which
		// is a different message from "the device's key changed".
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "SSH host key checking is not configured on the backend",
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not check the stored host key"})
		return
	}

	// 200 for a mismatch too. It is a successful answer to the question that was asked, and the
	// worker refuses the connection on the verdict, not on the status code.
	c.JSON(http.StatusOK, gin.H{
		"verdict":  verdict,
		"expected": expected,
		"host":     hostport,
	})
}
