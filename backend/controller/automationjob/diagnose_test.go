package automationjob

import (
	"strings"
	"testing"
)

func TestAnnotateJobResult(t *testing.T) {
	const workerAuthFailure = "login refused (check the username/password)"

	cases := []struct {
		name        string
		status      string
		result      string
		legacy      bool
		wantAdvice  bool
		description string
	}{
		{
			name: "the case this exists for", status: "FAILED", result: workerAuthFailure,
			legacy: true, wantAdvice: true,
			description: "an auth failure on the unmaintained device-row credential",
		},
		{
			name: "a nominated account that really is wrong", status: "FAILED", result: workerAuthFailure,
			legacy: false, wantAdvice: false,
			description: "somebody chose this account; 'check the password' is the right advice",
		},
		{
			name: "unreachable, not unauthenticated", status: "FAILED",
			result: "cannot reach 10.0.99.201:22 (network, or allowaccess ssh)",
			legacy: true, wantAdvice: false,
			description: "a network problem is not a credential problem, whatever credential was used",
		},
		{
			name: "a success is never annotated", status: "SUCCESS", result: "commit=abc123 lines=33000",
			legacy: true, wantAdvice: false,
		},
		{
			name: "netmiko's own phrasing too", status: "FAILED",
			result: "SSH Authentication failed for admin@10.0.99.201",
			legacy: true, wantAdvice: true,
			description: "netmiko's own wording, which the worker passes through in some paths",
		},
		{
			name: "a row written before the worker spoke English", status: "FAILED",
			result: "login ไม่ผ่าน (ตรวจ username/password)",
			legacy: true, wantAdvice: true,
			description: "automation_jobs still holds the worker's old Thai phrasing, and the " +
				"Jobs page reads those rows",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := annotateJobResult(tc.status, tc.result, tc.legacy)

			if !strings.HasPrefix(got, tc.result) {
				t.Fatalf("the worker's own message was altered:\n  got  %q\n  from %q", got, tc.result)
			}
			hasAdvice := strings.Contains(got, "use for scheduled work")
			if hasAdvice != tc.wantAdvice {
				t.Errorf("advice present = %v, want %v — %s", hasAdvice, tc.wantAdvice, tc.description)
			}
		})
	}
}

// A job retried three times must not accumulate three copies of the same paragraph.
func TestAnnotateJobResultIsIdempotent(t *testing.T) {
	first := annotateJobResult("FAILED", "login refused (check the username/password)", true)
	second := annotateJobResult("FAILED", first, true)
	if first != second {
		t.Errorf("annotating twice changed the message:\n  once  %q\n  twice %q", first, second)
	}
	if n := strings.Count(second, "use for scheduled work"); n != 1 {
		t.Errorf("the advice appears %d times, want 1", n)
	}
}
