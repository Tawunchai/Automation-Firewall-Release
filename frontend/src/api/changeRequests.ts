import { baseApi } from "./http";

// Change Requests — the queue between "I think this rule is right" and a production firewall
// enforcing it.
//
// middleware.RequireApproval turns a NON-ADMIN account's write to a firewall policy, a virtual IP
// or a security profile into a pending row here and answers HTTP 202 `{"pending": true}` instead of
// touching the device. Nothing was written. Until somebody reviews the row, nothing ever is.
//
// ── Why the review call does not simply resolve-or-throw ─────────────────────
//
// POST /change-requests/:id/review has FIVE meaningful answers and only one of them is "it
// worked". Two of them are 2xx and one is a 5xx, which is exactly the shape that gets collapsed
// into `try { message.success(…) } catch { message.error(…) }` by accident:
//
//   200 + reject   the reviewer said no. Nothing went to the device, and nothing was supposed to.
//   200 + approve  approved, and the row says it is applied — the ONLY answer that means the
//                  firewall changed.
//   200 + window   approved and held for its maintenance window. Not on the device yet.
//   207            the approval is RECORDED and the FIREWALL REFUSED THE WRITE. The server answers
//                  207 rather than 4xx/5xx precisely so the operator does not read it as "your
//                  approval failed" and press Approve again — but it must never render as success:
//                  the rule the reviewer just approved is not in force.
//   502            approved, and the write could not be attempted at all. The row stays `approved`
//                  and the scheduler's sweep will retry it; the device is unchanged for now.
//
// So the HTTP status is classified ONCE, here, into an outcome the page can switch on, and
// `onDevice` is the single flag that answers "is this change actually on the firewall". Anything
// the reviewer is not allowed to do — self-approval, a second review, an expired request — is a
// 409 with a sentence written for a human, and those still reject, because the review did not
// happen and there is nothing to report but the refusal.

export type ChangeRequestStatus =
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "withdrawn"
  | "failed"
  | "expired";

/** The slice of NetworkDevice the queue's Preload ships. */
export type ChangeRequestDevice = {
  id: number;
  name: string;
  mgmt_ip?: string;
  vendor?: string;
  site?: string;
  status?: string;
};

/** One queued write, exactly as entity.ChangeRequest serialises it. */
export type ChangeRequest = {
  id: number;
  created_at: string;

  network_device_id: number;
  network_device?: ChangeRequestDevice | null;

  /**
   * The SERVER's summary of the write, derived from the method and the target
   * (services.PrepareChangeRequest → DescribeApprovalTitle). It is not the requester's wording:
   * whatever they typed is filed under `reason`, prefixed with "Requester's own title".
   *
   * A row raised before that change still holds a requester-typed title, which is why the page
   * derives its own summary from the fields below and shows this one beside it rather than
   * instead of it.
   */
  title: string;
  /** Why. The requester's own words live here, their own title among them. */
  reason: string;

  /** The HTTP request that will be replayed if this is approved. This is what it DOES. */
  method: string;
  path: string;
  body: string;

  /** Derived from `path` by the server at creation time, and stored. */
  resource_type: string;
  resource_key: string;

  requested_by_id: number;
  requested_by: string;
  requested_at: string;

  reviewed_by_id?: number;
  reviewed_by?: string;
  reviewed_at?: string | null;
  review_note?: string;

  status: ChangeRequestStatus;

  /** An approved request held until its maintenance window. */
  scheduled_for?: string | null;
  /** When an un-reviewed request stops being applicable. */
  expires_at: string;

  applied_at?: string | null;
  /** The Change Ledger row the apply produced, when there is one. */
  change_record_id?: number | null;
  error_text?: string;

  /** Approved by its own requester, which the server allows only for a sole admin. */
  self_approved: boolean;
};

export type ListChangeRequestsOpts = {
  status?: ChangeRequestStatus;
  /** Only the signed-in account's own requests. */
  mine?: boolean;
};

/**
 * The queue, newest first, scoped by the server to the devices the caller may see.
 *
 * Deliberately NOT lenient: a failure rejects, so the page can say "the queue could not be read"
 * instead of drawing an empty list. An empty queue means nothing is waiting for a reviewer; an
 * unreadable one means changes may well be waiting and nobody can see them.
 */
export const ListChangeRequests = async (
  opts: ListChangeRequestsOpts = {},
): Promise<ChangeRequest[]> => {
  const params: Record<string, string> = {};
  if (opts.status) params.status = opts.status;
  if (opts.mine) params.mine = "true";
  const res = await baseApi.get("/change-requests", { params });
  // The controller answers with a JSON array in every success case. A 200 carrying something else
  // is the server answering "nothing", not a failure to read it.
  return Array.isArray(res.data) ? (res.data as ChangeRequest[]) : [];
};

/** One request, with its device preloaded. 404 for an id outside the caller's device access. */
export const GetChangeRequest = async (id: number): Promise<ChangeRequest> => {
  const res = await baseApi.get(`/change-requests/${id}`);
  return res.data as ChangeRequest;
};

/**
 * What a review actually achieved.
 *
 * `applied` is the only outcome that means the firewall changed, and `onDevice` is derived from
 * the outcome rather than from the HTTP status, so a caller cannot read a 207 as a success by
 * reading `res.status < 300`.
 */
export type ReviewOutcome =
  /** The reviewer said no. */
  | "rejected"
  /** Approved, replayed, and the device accepted it. */
  | "applied"
  /** Approved and held for its maintenance window. */
  | "scheduled"
  /** Approved; the row does not (yet) say the write landed. */
  | "approved"
  /** 207 — the approval is recorded and the firewall refused the write. */
  | "device-refused"
  /** 502 — the approval is recorded and the write could not be attempted. */
  | "apply-failed";

export type ReviewResult = {
  outcome: ReviewOutcome;
  /** True ONLY when the change is on the firewall. Never true for 207 or 502. */
  onDevice: boolean;
  /** The server's own sentence — it is written for a person, so it is shown as-is. */
  message: string;
  /** The device's refusal, for the two outcomes that carry one. */
  detail?: string;
  /** The row as it now stands, when the server returned it. */
  request?: ChangeRequest;
};

/** The JSON shape every review answer shares. */
export type ReviewPayload = {
  message?: string;
  error?: string;
  detail?: string;
  data?: ChangeRequest;
};

/**
 * Turns one HTTP answer into an outcome. Pure, and exported so it can be tested without a server —
 * the 207 case is the one that must never come out as a success.
 */
export const classifyReview = (
  status: number,
  approve: boolean,
  payload: ReviewPayload | undefined,
): ReviewResult => {
  const p = payload ?? {};
  const row = p.data;

  // The approval is recorded; the write did not land. Both of these are reported to the reviewer
  // as a FAILURE of the change, with the device's own words, and neither is retried by pressing
  // Approve again — the row has already left `pending`.
  if (status === 207) {
    return {
      outcome: "device-refused",
      onDevice: false,
      message: p.message ?? "The approval was recorded, but the firewall refused the write",
      detail: p.detail ?? p.error,
      request: row,
    };
  }
  if (status === 502) {
    return {
      outcome: "apply-failed",
      onDevice: false,
      message: p.error ?? "The approval was recorded, but the change could not be applied",
      detail: p.detail,
      request: row,
    };
  }

  if (!approve) {
    return {
      outcome: "rejected",
      onDevice: false,
      message: p.message ?? "Change request rejected",
      request: row,
    };
  }

  // An approval. Only the stored row may say the write landed — not the status code, and not the
  // wording of the message. With no row at all the honest answer is "approved", which claims
  // nothing about the device.
  if (row?.status === "applied") {
    return {
      outcome: "applied",
      onDevice: true,
      message: p.message ?? "Change request approved and applied",
      request: row,
    };
  }
  if (row?.status === "failed") {
    return {
      outcome: "device-refused",
      onDevice: false,
      message: p.message ?? "The approval was recorded, but the firewall refused the write",
      detail: p.detail ?? row.error_text,
      request: row,
    };
  }
  if (row?.scheduled_for) {
    return {
      outcome: "scheduled",
      onDevice: false,
      message: p.message ?? "Change request approved — it will be applied in its window",
      request: row,
    };
  }
  return {
    outcome: "approved",
    onDevice: false,
    message: p.message ?? "Change request approved",
    request: row,
  };
};

export type ReviewInput = {
  approve: boolean;
  note?: string;
  /** ISO timestamp. Approve now, apply then. Ignored by the server on a rejection. */
  scheduled_for?: string | null;
};

/**
 * Records a decision. Admin-only on the server, and the server also refuses an approval by the
 * person who raised it — that refusal is a 409 and rejects here, with the server's sentence.
 *
 * 502 is accepted as a resolved answer on purpose: it reports that the approval HAPPENED and the
 * apply did not, which the reviewer has to be told. Letting axios throw it would have put it in
 * the same catch block as "you may not approve your own request", where the only thing the page
 * could say is "something went wrong".
 */
export const ReviewChangeRequest = async (
  id: number,
  input: ReviewInput,
): Promise<ReviewResult> => {
  const res = await baseApi.post<ReviewPayload>(
    `/change-requests/${id}/review`,
    {
      approve: input.approve,
      note: input.note ?? "",
      scheduled_for: input.scheduled_for ?? null,
    },
    { validateStatus: (s) => (s >= 200 && s < 300) || s === 502 },
  );
  return classifyReview(res.status, input.approve, res.data);
};

/**
 * Takes a pending request back. Requester-only (403 otherwise) and pending-only (409 otherwise);
 * both reject with the server's own sentence.
 */
export const WithdrawChangeRequest = async (id: number): Promise<string> => {
  const res = await baseApi.post<{ message?: string }>(`/change-requests/${id}/withdraw`);
  return res.data?.message ?? "Change request withdrawn";
};
