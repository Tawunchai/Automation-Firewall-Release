import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFetch } from "./useFetch";

// useFetch races the request against a 20s timeout. The timeout's setTimeout was never cleared, so
// on the normal path — where the request wins — the timer stayed pending for the full 20s holding
// the whole closure alive (the AbortController, the fetch function, the component's state
// setters), and every refetch added another one.
//
// These tests pin the fix and, just as importantly, the behaviour around it: the loading flag has
// to still clear on success. The obvious version of the fix (abort the controller unconditionally
// in `finally`) breaks exactly that, because the "am I still the current fetch?" guard was written
// in terms of `signal.aborted`.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type HookResult<T> = ReturnType<typeof useFetch<T>>;

/** Minimal renderHook — the project has no @testing-library/react. */
function renderHook<T>(fetchFn: Parameters<typeof useFetch<T>>[0], deps: unknown[] = []) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  const current: { value: HookResult<T> | null } = { value: null };

  function Probe() {
    current.value = useFetch<T>(fetchFn, deps);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  return {
    current,
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** Lets queued microtasks (the awaited fetch promise) settle inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useFetch — timer lifecycle", () => {
  it("leaves no pending timer after a successful fetch", async () => {
    const { unmount } = renderHook(async () => "ok");
    await flush();

    expect(
      vi.getTimerCount(),
      "the 20s timeout races the request; when the request wins the timer must be cleared, " +
        "or it keeps the whole closure alive for 20s",
    ).toBe(0);

    unmount();
  });

  it("leaves no pending timer after a failed fetch", async () => {
    const { unmount } = renderHook(async () => {
      throw new Error("boom");
    });
    await flush();

    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("does not accumulate timers across repeated refetches", async () => {
    const { current, unmount } = renderHook(async () => "ok");
    await flush();

    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await current.value!.refetch();
      });
    }

    expect(
      vi.getTimerCount(),
      "ten refetches used to leave ten 20-second timers pending",
    ).toBe(0);

    unmount();
  });

  it("clears the timer on unmount mid-flight", async () => {
    let resolve!: (v: string) => void;
    const { unmount } = renderHook(() => new Promise<string>((r) => { resolve = r; }));
    await flush();

    unmount();
    resolve("late");
    await flush();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useFetch — state", () => {
  it("delivers data and clears loading on success", async () => {
    const { current, unmount } = renderHook(async () => ({ id: 1 }));
    await flush();

    expect(current.value!.data).toEqual({ id: 1 });
    expect(current.value!.error).toBeNull();
    expect(
      current.value!.loading,
      "REGRESSION GUARD: aborting the controller in `finally` makes signal.aborted always true, " +
        "which silently strands the spinner on forever",
    ).toBe(false);

    unmount();
  });

  it("reports an error and clears loading on failure", async () => {
    const { current, unmount } = renderHook(async () => {
      throw new Error("network down");
    });
    await flush();

    expect(current.value!.error).toBe("network down");
    expect(current.value!.loading).toBe(false);
    expect(current.value!.data).toBeNull();

    unmount();
  });

  it("times out a request that never settles, and says so in plain words", async () => {
    const { current, unmount } = renderHook(() => new Promise<string>(() => {}));
    await flush();

    expect(current.value!.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await flush();

    expect(current.value!.error).toBe("Request timed out");
    expect(current.value!.loading).toBe(false);

    unmount();
  });

  it("aborts the underlying request when it times out", async () => {
    let captured: AbortSignal | undefined;
    const { unmount } = renderHook((signal: AbortSignal) => {
      captured = signal;
      return new Promise<string>(() => {});
    });
    await flush();

    expect(captured!.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await flush();

    expect(
      captured!.aborted,
      "a request we gave up on must be cancelled, or it holds a connection and its response body",
    ).toBe(true);

    unmount();
  });

  it("does not abort a request that succeeded", async () => {
    let captured: AbortSignal | undefined;
    const { unmount } = renderHook(async (signal: AbortSignal) => {
      captured = signal;
      return "ok";
    });
    await flush();

    expect(captured!.aborted).toBe(false);
    unmount();
  });

  it("passes an AbortSignal only to a fetcher that asks for one", async () => {
    // The hook branches on fetchFn.length, so a zero-arg fetcher must be called with no args.
    const noArg = vi.fn(async () => "ok");
    const { unmount } = renderHook(noArg);
    await flush();

    expect(noArg).toHaveBeenCalledWith();
    unmount();
  });

  it("ignores a concurrent refetch while one is already in flight", async () => {
    const calls = vi.fn(async () => "ok");
    let resolve!: (v: string) => void;
    const slow = vi.fn(() => {
      calls();
      return new Promise<string>((r) => { resolve = r; });
    });

    const { current, unmount } = renderHook(slow);
    await flush();

    await act(async () => {
      void current.value!.refetch();
      void current.value!.refetch();
    });

    expect(slow).toHaveBeenCalledTimes(1);

    resolve("ok");
    await flush();
    unmount();
  });
});
