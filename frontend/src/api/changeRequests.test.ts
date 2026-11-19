import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeRequest } from "./changeRequests";

// The Change Request queue's one dangerous answer: HTTP 207.
//
// POST /change-requests/:id/review answers 207 when the approval WAS recorded and the firewall then
// refused the write. The server chose a 2xx deliberately — a 4xx would read as "your approval
// failed" and the operator would press Approve again — which means every naive client reads it as a
// success, says "approved and applied", and leaves a reviewer believing a rule is in force that is
// not on the device at all. On a first-match rule base that belief is the outage.
//
// So these tests pin the classification, not the transport: what the page is told happened, for
// each answer the endpoint can give.

const get = vi.fn();
const post = vi.fn();
vi.mock("./http", () => ({
  baseApi: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

const load = async () => await import("./changeRequests");

afterEach(() => {
  get.mockReset();
  post.mockReset();
});

const row = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: 7,
  created_at: "2026-11-16T09:00:00Z",
  status: "pending",
  network_device_id: 1,
  title: "Allow the printer",
  reason: "because",
  method: "POST",
  path: "/policy/device/1/firewall-policies",
  body: "{}",
  resource_type: "firewall-policies",
  resource_key: "",
  requested_by_id: 4,
  requested_by: "user@got.co.th",
  requested_at: "2026-11-16T09:00:00Z",
  expires_at: "2026-11-23T09:00:00Z",
  self_approved: false,
  ...over,
});

describe("ListChangeRequests", () => {
  it("passes the status and mine filters the server understands", async () => {
    const { ListChangeRequests } = await load();
    get.mockResolvedValue({ data: [] });

    await ListChangeRequests({ status: "pending", mine: true });

    expect(get).toHaveBeenCalledWith("/change-requests", {
      params: { status: "pending", mine: "true" },
    });
  });

  it("sends no filters when none were asked for", async () => {
    const { ListChangeRequests } = await load();
    get.mockResolvedValue({ data: [] });

    await ListChangeRequests();

    expect(get).toHaveBeenCalledWith("/change-requests", { params: {} });
  });

  it("rejects rather than reporting an empty queue when the read fails", async () => {
    // "Unreadable" is not "nothing is waiting". A queue that draws itself empty on a 500 tells an
    // admin there is nothing to approve, while proposed firewall changes sit in the database.
    const { ListChangeRequests } = await load();
    get.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500 } }));

    await expect(ListChangeRequests()).rejects.toThrow();
  });
});

describe("ReviewChangeRequest", () => {
  it("sends the decision, the note and the window", async () => {
    const { ReviewChangeRequest } = await load();
    post.mockResolvedValue({ status: 200, data: { message: "ok", data: row({ status: "applied" }) } });

    await ReviewChangeRequest(7, { approve: true, note: "looks right", scheduled_for: "2026-12-01T22:00:00Z" });

    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/change-requests/7/review");
    expect(body).toEqual({
      approve: true,
      note: "looks right",
      scheduled_for: "2026-12-01T22:00:00Z",
    });
  });

  it("treats a 207 as a FAILED change, not a success", async () => {
    const { ReviewChangeRequest } = await load();
    post.mockResolvedValue({
      status: 207,
      data: {
        message: "change request approved, but the device refused the write",
        detail: "FortiGate error: error code -5",
        data: row({ status: "failed" }),
      },
    });

    const res = await ReviewChangeRequest(7, { approve: true });

    expect(res.outcome).toBe("device-refused");
    expect(res.onDevice).toBe(false);
    expect(res.detail).toContain("-5");
  });

  it("reports a 502 as approved-but-not-applied instead of throwing it into the same catch as a refusal", async () => {
    // A 502 means the approval is recorded and the write never reached the device. If it threw, the
    // page could only say "something went wrong", and the reviewer would press Approve again — on a
    // request that has already left `pending` and will be retried by the scheduler's sweep.
    const { ReviewChangeRequest } = await load();
    post.mockResolvedValue({
      status: 502,
      data: { error: "approved, but it could not be applied: dial tcp: i/o timeout", data: row({ status: "approved" }) },
    });

    const res = await ReviewChangeRequest(7, { approve: true });

    expect(res.outcome).toBe("apply-failed");
    expect(res.onDevice).toBe(false);
    expect(res.message).toContain("could not be applied");
  });

  it("accepts a 502 as a resolved answer at the transport level", async () => {
    const { ReviewChangeRequest } = await load();
    post.mockResolvedValue({ status: 502, data: { error: "nope" } });

    await ReviewChangeRequest(7, { approve: true });

    const opts = post.mock.calls[0][2] as { validateStatus: (s: number) => boolean };
    expect(opts.validateStatus(200)).toBe(true);
    expect(opts.validateStatus(207)).toBe(true);
    expect(opts.validateStatus(502)).toBe(true);
    // A refusal must still reject — there is nothing to report but the server's sentence.
    expect(opts.validateStatus(409)).toBe(false);
    expect(opts.validateStatus(403)).toBe(false);
  });

  it("lets a 409 reject, so the server's human-written refusal is what the page shows", async () => {
    const { ReviewChangeRequest } = await load();
    post.mockRejectedValue(
      Object.assign(new Error("Request failed"), {
        response: { status: 409, data: { error: "a change request cannot be approved by the person who raised it" } },
      }),
    );

    await expect(ReviewChangeRequest(7, { approve: true })).rejects.toThrow();
  });
});

describe("classifyReview", () => {
  it("calls an approval applied only when the stored row says so", async () => {
    const { classifyReview } = await load();

    expect(classifyReview(200, true, { data: row({ status: "applied" }) }).outcome).toBe("applied");
    expect(classifyReview(200, true, { data: row({ status: "applied" }) }).onDevice).toBe(true);
  });

  it("never claims the device changed when the row does not say it did", async () => {
    const { classifyReview } = await load();
    const answers = [
      classifyReview(200, true, { data: row({ status: "approved" }) }),
      classifyReview(200, true, { data: row({ status: "approved", scheduled_for: "2026-12-01T22:00:00Z" }) }),
      classifyReview(200, true, { data: row({ status: "failed" }) }),
      classifyReview(200, true, {}),
      classifyReview(207, true, { data: row({ status: "failed" }) }),
      classifyReview(502, true, { data: row({ status: "approved" }) }),
      classifyReview(200, false, { data: row({ status: "rejected" }) }),
    ];

    expect(answers.map((a) => a.onDevice)).toEqual([false, false, false, false, false, false, false]);
  });

  it("separates a scheduled approval from a plain one", async () => {
    const { classifyReview } = await load();

    expect(classifyReview(200, true, { data: row({ status: "approved", scheduled_for: "2026-12-01T22:00:00Z" }) }).outcome)
      .toBe("scheduled");
    expect(classifyReview(200, true, { data: row({ status: "approved" }) }).outcome).toBe("approved");
  });

  it("reads a rejection as a rejection whatever the row says", async () => {
    const { classifyReview } = await load();

    expect(classifyReview(200, false, { message: "change request rejected" }).outcome).toBe("rejected");
  });

  it("falls back to a non-claiming outcome when the server returned no row", async () => {
    // Without the row there is no evidence the write landed, so the honest answer is the one that
    // claims nothing about the firewall.
    const { classifyReview } = await load();
    const res = classifyReview(200, true, { message: "change request approved" });

    expect(res.outcome).toBe("approved");
    expect(res.onDevice).toBe(false);
  });

  it("survives an answer with no body at all", async () => {
    const { classifyReview } = await load();

    expect(classifyReview(207, true, undefined).outcome).toBe("device-refused");
    expect(classifyReview(207, true, undefined).message).not.toBe("");
  });

  it("prefers the row's stored error text when a 200 carries a failed row with no detail", async () => {
    const { classifyReview } = await load();
    const res = classifyReview(200, true, { data: row({ status: "failed", error_text: "error code -5" }) });

    expect(res.outcome).toBe("device-refused");
    expect(res.detail).toBe("error code -5");
  });
});

describe("WithdrawChangeRequest", () => {
  it("posts to the withdraw route and returns the server's line", async () => {
    const { WithdrawChangeRequest } = await load();
    post.mockResolvedValue({ data: { message: "change request withdrawn" } });

    await expect(WithdrawChangeRequest(7)).resolves.toBe("change request withdrawn");
    expect(post).toHaveBeenCalledWith("/change-requests/7/withdraw");
  });

  it("rejects on a 403, because somebody else's request is not yours to take back", async () => {
    const { WithdrawChangeRequest } = await load();
    post.mockRejectedValue(
      Object.assign(new Error("Request failed"), { response: { status: 403, data: { error: "only the person who raised a request may withdraw it" } } }),
    );

    await expect(WithdrawChangeRequest(7)).rejects.toThrow();
  });
});

describe("GetChangeRequest", () => {
  it("reads one row by id", async () => {
    const { GetChangeRequest } = await load();
    get.mockResolvedValue({ data: row() });

    await expect(GetChangeRequest(7)).resolves.toMatchObject({ id: 7 });
    expect(get).toHaveBeenCalledWith("/change-requests/7");
  });
});
