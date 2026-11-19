import type { TimelineItem } from "../../api/drift";

// What a timeline row says about itself — its status and, above all, the answer to "can this be
// taken back?". Pure, so every wording can be pinned by a test: this is the text a person reads
// right before pressing a button that writes to a live firewall, and it has to be true.

export type RowStatus = "applied" | "failed" | "reverted" | "standing" | "undone";

export const ACTION_VERB: Record<TimelineItem["action"], string> = {
  create: "Created",
  update: "Changed",
  delete: "Deleted",
};

/** One status per row, from whichever source it came from. */
export const statusOf = (it: TimelineItem): RowStatus => {
  if (it.kind === "console") {
    if (it.status === "failed") return "failed";
    if (it.status === "reverted") return "reverted";
    return "applied";
  }
  // An outside change has exactly two states now that it cannot be signed off by hand: the console
  // took it back, or it is still on the firewall. "Standing" is deliberately not an alarm — an
  // unrecorded change is not a wrong one — it is a statement of fact about the device right now.
  return it.undo_change_id ? "undone" : "standing";
};

/**
 * The row's own answer to "can this be taken back, and what would that do?".
 *
 * Every sentence is written for the case it describes — "undo" means something different for a
 * console change (replay the recorded state) and for an object created outside (delete it), and the
 * restore case has to say out loud that it is the WHOLE firewall and that it reboots.
 */
export const fallbackExplanation = (it: TimelineItem): string => {
  if (it.kind === "console") {
    if (it.fallback === "undo") {
      switch (it.action) {
        case "create":
          return "Yes. Undo deletes the object this change created. The undo is recorded here too.";
        case "delete":
          return "Yes. Undo recreates the object with the values recorded before it was deleted. The undo is recorded here too.";
        default:
          return "Yes. Undo writes back the values the object had before this change. The undo is recorded here too.";
      }
    }
    if (it.status === "reverted") return "It has already been undone.";
    if (it.status === "failed") return "Nothing to undo — the firewall rejected this change, so it never applied.";
    return it.undo_note ? `No — ${it.undo_note}.` : "No.";
  }

  // Outside the console.
  if (it.undo_change_id) return "It has already been undone from this console — the object was deleted from the firewall.";
  if (it.fallback === "undo") {
    return "Yes. This object was created outside the console, so undoing it deletes it from the firewall. " +
      "The firewall refuses if something still uses it. The delete is recorded, so it can be undone too.";
  }
  if (it.fallback === "restore") {
    // Two whole sentences rather than one with a word swapped in: the dictionary translates a
    // sentence, and a sentence assembled from pieces has no entry to match.
    return it.action === "delete"
      ? "Not on its own — the console holds the deleted object only as lines in a backup, which cannot be recreated safely one object at a time. " +
        "The fallback is to restore the backup taken before the change: the whole firewall returns to that moment, " +
        "every change made since is lost (including ones made here), and the firewall reboots. You see a preview first."
      : "Not on its own — the console holds this object's earlier version only as lines in a backup, which cannot be put back safely one object at a time. " +
        "The fallback is to restore the backup taken before the change: the whole firewall returns to that moment, " +
        "every change made since is lost (including ones made here), and the firewall reboots. You see a preview first.";
  }
  return it.undo_note ? `No — ${it.undo_note}.` : "No.";
};
