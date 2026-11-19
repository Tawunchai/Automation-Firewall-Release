package policyobject

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"network_automation/services"
)

// The interface in device_client.go is generated from *services.FortiClient's method set, and the
// compile-time assertion at the bottom of that file proves every method the INTERFACE names really
// exists on the client. This test proves the other direction, which the compiler cannot: that the
// interface has not fallen BEHIND the client.
//
// Without it, adding a method to FortiClient and forgetting to regenerate would leave a method a
// handler cannot reach through the seam — and the failure would show up as a confusing compile
// error in whatever handler happened to need it next, not as "the generated file is stale".
func TestDeviceClientCoversEveryExportedFortiClientMethod(t *testing.T) {
	iface := reflect.TypeOf((*deviceClient)(nil)).Elem()
	impl := reflect.TypeOf((*services.FortiClient)(nil))

	named := make(map[string]bool, iface.NumMethod())
	for i := 0; i < iface.NumMethod(); i++ {
		named[iface.Method(i).Name] = true
	}

	var missing []string
	for i := 0; i < impl.NumMethod(); i++ {
		if name := impl.Method(i).Name; !named[name] {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)

	if len(missing) > 0 {
		t.Fatalf("deviceClient is missing %d exported method(s) of *services.FortiClient: %s\n\n"+
			"device_client.go is generated from that method set — regenerate it rather than adding the\n"+
			"methods by hand, or the two will drift again on the next one.",
			len(missing), strings.Join(missing, ", "))
	}
}

// A seam is only worth having if the real client still fits through it. The compile-time assertion
// covers that, but it says nothing about the interface being WORTH anything: an empty interface
// would also compile. This keeps the generated file from being quietly emptied.
func TestDeviceClientDescribesTheWholeDeviceSurface(t *testing.T) {
	n := reflect.TypeOf((*deviceClient)(nil)).Elem().NumMethod()
	// The real number is in the high 200s. The floor is deliberately well below it: this test is
	// here to catch an empty or truncated generation, not to be edited every time the client gains
	// a method — that is what the drift test above is for.
	if n < 200 {
		t.Fatalf("deviceClient declares only %d methods; the client has a far larger surface than that, so the generated file looks truncated", n)
	}
}
