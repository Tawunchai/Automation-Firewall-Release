package automationjob

import "testing"

// diffSummary is the "+N/-M lines" the Backups list shows beside every stored configuration, and
// it is the backend's FALLBACK: the worker normally computes the diff, and when it does not, this
// runs instead (see WorkerResult). So the number an operator reads to decide "did anything change
// on this firewall last night" comes from here, and it had one covered statement out of eight.
//
// No database: this is a pure function over two strings.
//
// Three properties are worth pinning, because each one would be invisible if it broke:
//
//  1. NO PREVIOUS BACKUP IS NOT "NOTHING CHANGED". The first backup of a device returns "" — an
//     empty summary the UI renders as "no comparison" — not "+0/-0 lines", which would claim the
//     configuration was compared against something and found identical.
//  2. It is a MULTISET difference, not a line-by-line edit script. A line that appears three times
//     and now appears five contributes +2. This matters on FortiOS configs, which are full of
//     repeated `next` and `end` lines.
//  3. Because it is a multiset difference it is ORDER BLIND: moving a block without changing it
//     reports +0/-0. That is deliberate — FortiOS re-orders table entries on its own, and a
//     summary that cried "changed" every time a policy was renumbered would train people to
//     ignore it — but it is also the property most likely to surprise, so it is written down as a
//     test rather than left to be rediscovered.

func TestDiffSummary(t *testing.T) {
	cases := []struct {
		name     string
		old, new string
		want     string
	}{
		{
			name: "no previous backup — no comparison was made",
			old:  "",
			new:  "config system global\n    set hostname \"FGT\"\nend\n",
			want: "",
		},
		{
			name: "identical configurations",
			old:  "a\nb\nc\n",
			new:  "a\nb\nc\n",
			want: "+0/-0 lines",
		},
		{
			name: "one line added",
			old:  "a\nb\n",
			new:  "a\nb\nc\n",
			want: "+1/-0 lines",
		},
		{
			name: "one line removed",
			old:  "a\nb\nc\n",
			new:  "a\nb\n",
			want: "+0/-1 lines",
		},
		{
			name: "a setting changed — one line out, one line in",
			old:  "    set hostname \"old-name\"\n",
			new:  "    set hostname \"new-name\"\n",
			want: "+1/-1 lines",
		},
		{
			// Property 2. The naive "count distinct lines" implementation answers +0/-0 here.
			name: "a repeated line gains two more occurrences",
			old:  "next\nnext\nend\n",
			new:  "next\nnext\nnext\nnext\nend\n",
			want: "+2/-0 lines",
		},
		{
			name: "a repeated line loses occurrences",
			old:  "next\nnext\nnext\nend\n",
			new:  "next\nend\n",
			want: "+0/-2 lines",
		},
		{
			// Property 3, stated as a test so it is a decision rather than an accident.
			name: "the same lines in a different order",
			old:  "edit 1\nedit 2\nedit 3\n",
			new:  "edit 3\nedit 2\nedit 1\n",
			want: "+0/-0 lines",
		},
		{
			// A device that answered with nothing. The whole previous configuration counts as
			// removed, which is exactly the alarming number somebody should see.
			name: "the new configuration is empty",
			old:  "a\nb\nc\n",
			new:  "",
			want: "+0/-3 lines",
		},
		{
			name: "a whole block added",
			old:  "config system global\nend\n",
			new:  "config system global\nend\nconfig firewall policy\n    edit 1\n    next\nend\n",
			want: "+4/-0 lines",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := diffSummary(tc.old, tc.new); got != tc.want {
				t.Errorf("diffSummary() = %q, want %q\nold:\n%s\nnew:\n%s",
					got, tc.want, tc.old, tc.new)
			}
		})
	}
}

// The empty-old rule is the one that would be "fixed" by someone tidying the early return, so it
// gets a test that says what it is for rather than only a table row.
func TestDiffSummaryDoesNotClaimAComparisonItCouldNotMake(t *testing.T) {
	if got := diffSummary("", "anything at all\n"); got != "" {
		t.Errorf("the first backup of a device reported %q. There is nothing to compare it "+
			"against, and any summary here is read as a comparison that happened — "+
			"\"+0/-0 lines\" in particular would say the firewall's configuration is unchanged "+
			"since a backup that does not exist", got)
	}
}
