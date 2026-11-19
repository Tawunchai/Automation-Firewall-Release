package services

import "testing"

// The transport really is wired to the checking dialler.
//
// Asserted because the alternative — hanging the check off TLSClientConfig.VerifyConnection — looks
// equivalent, compiles, and silently keys the whole fleet under one empty host: ServerName is EMPTY
// when the host is an IP, which every device in this console is. If someone "simplifies" this back,
// the check stops checking and nothing else fails.
func TestTheSharedTransportDialsThroughTheCertificateCheck(t *testing.T) {
	if fgTransport.DialTLSContext == nil {
		t.Fatal("fgTransport has no DialTLSContext — certificates are not being pinned at all")
	}
	if fgTransport.TLSClientConfig == nil || !fgTransport.TLSClientConfig.InsecureSkipVerify {
		t.Error("certificate verification against a CA is on — FortiOS ships self-signed " +
			"certificates and every call would fail")
	}
	if fgTransport.TLSClientConfig.ClientSessionCache == nil {
		t.Error("no ClientSessionCache — every handshake that has to happen is a full one")
	}
}
