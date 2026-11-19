import { describe, expect, it } from "vitest";

import { apiErrorDetail, apiErrorText, errorText } from "./errorText";

// The three answers to "what do we show the person for something that was thrown".
//
// They exist because `catch (e: any)` was the shape that kept re-introducing `any` into this
// codebase — 101 of them — and the conversion away from it is only safe if the difference between
// these three is pinned. It is not a style difference: apiErrorText and apiErrorDetail differ by
// one step, and that step decides whether the user reads the sentence the page author wrote or
// "Request failed with status code 500".

/** What axios rejects with: an Error whose message is about HTTP, carrying the server's body. */
const axiosError = (body: unknown, message = "Request failed with status code 500") =>
  Object.assign(new Error(message), { response: { data: body } });

describe("errorText", () => {
  it("prefers an Error's own message", () => {
    expect(errorText(new Error("the firewall refused the write"), "fallback"))
      .toBe("the firewall refused the write");
  });

  it("accepts a thrown string, because JavaScript allows one", () => {
    expect(errorText("plain string", "fallback")).toBe("plain string");
  });

  it("falls back for everything with nothing to say", () => {
    for (const thrown of [undefined, null, 0, {}, [], new Error(""), ""]) {
      expect(errorText(thrown, "fallback")).toBe("fallback");
    }
  });
});

describe("apiErrorDetail", () => {
  it("returns the server's own error line", () => {
    expect(apiErrorDetail(axiosError({ error: "FortiGate error: -5" }), "could not save"))
      .toBe("FortiGate error: -5");
  });

  // The whole reason this function exists separately. The page author's sentence says what the
  // user was trying to do; axios's says which status code came back.
  it("does NOT fall through to the Error message", () => {
    expect(apiErrorDetail(axiosError({ detail: "something else" }), "could not save"))
      .toBe("could not save");
    expect(apiErrorDetail(new Error("Request failed with status code 500"), "could not save"))
      .toBe("could not save");
  });

  it("treats an empty server error as no error", () => {
    expect(apiErrorDetail(axiosError({ error: "" }), "could not save")).toBe("could not save");
  });

  it("survives a response shape it has never seen", () => {
    for (const body of [undefined, null, "a string body", 42, [], { error: 7 }]) {
      expect(apiErrorDetail(axiosError(body), "could not save")).toBe("could not save");
    }
    expect(apiErrorDetail({ response: null }, "could not save")).toBe("could not save");
    expect(apiErrorDetail({}, "could not save")).toBe("could not save");
  });
});

describe("apiErrorText", () => {
  it("prefers the server's error line", () => {
    expect(apiErrorText(axiosError({ error: "FortiGate error: -23" }), "could not delete"))
      .toBe("FortiGate error: -23");
  });

  // This is the step apiErrorDetail leaves out. It is right for a DeviceRequestError, whose
  // message is a composed sentence about the device.
  it("falls through to the Error message when the body has none", () => {
    expect(apiErrorText(axiosError({}, "lab-80E did not answer in 30s"), "could not delete"))
      .toBe("lab-80E did not answer in 30s");
  });

  it("falls back last", () => {
    expect(apiErrorText(axiosError({}, ""), "could not delete")).toBe("could not delete");
  });
});
