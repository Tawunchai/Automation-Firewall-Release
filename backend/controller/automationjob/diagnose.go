package automationjob

import "strings"

// Turning the worker's answer into one somebody can act on.
//
// The Python worker reports an SSH authentication failure as
//
//	login refused (check the username/password)
//
// which is accurate and sends the reader to exactly the wrong place. On this deployment every
// scheduled backup has failed that way since the feature shipped — config_backups has never held a
// row — and the cause was not a wrong password on the firewall. It was that nobody had nominated an
// account for scheduled work, so services.ResolveAutomationLogin fell back to the credential stored
// on the network_devices row: a value written by a form that no longer exists, never verified, and
// not the one the console itself uses for everything else.
//
// So when a job fails on authentication AND the login it used was that fallback, the failure says
// so. The operator's next click is then in the right place.

// authFailureMarkers are how the worker phrases "the device refused these credentials".
//
// The Thai phrasings are the ones the worker used before it was translated to English. They stay:
// automation_jobs rows written before that change still hold them, and the Jobs page reads those
// rows, so dropping the markers would silently stop explaining every historical failure.
var authFailureMarkers = []string{
	"login refused",
	"authentication",
	"check the username/password",
	"login ไม่ผ่าน",
	"ตรวจ username/password",
}

const legacyCredentialAdvice = " — this device has no account nominated for scheduled work, so the " +
	"job used the old login stored on the device record, which no screen maintains any more. " +
	"Open Profile ▸ Device Credentials, add your firewall account for this device and tick " +
	"\"use for scheduled work\"."

// looksLikeAuthFailure reports whether a worker result is the device refusing the credentials, as
// opposed to a network problem or a command that failed after a successful login.
func looksLikeAuthFailure(result string) bool {
	lower := strings.ToLower(result)
	for _, marker := range authFailureMarkers {
		if strings.Contains(lower, strings.ToLower(marker)) {
			return true
		}
	}
	return false
}

// annotateJobResult appends the real diagnosis when one applies.
//
// Pure, so the rule is testable without a worker, a database or a firewall — and so the two inputs
// that decide it are visible in the signature rather than fetched inside.
func annotateJobResult(status, result string, usedLegacyCredential bool) string {
	if status != "FAILED" || !usedLegacyCredential || !looksLikeAuthFailure(result) {
		return result
	}
	if strings.Contains(result, "use for scheduled work") {
		return result // already annotated; a retry must not stack the advice
	}
	return result + legacyCredentialAdvice
}
