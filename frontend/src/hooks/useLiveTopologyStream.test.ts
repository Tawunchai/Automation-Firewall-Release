import { describe, expect, it } from "vitest";
import { upsertById } from "./useLiveTopologyStream";

type Row = { device_id: number; v: string };

describe("upsertById", () => {
  it("appends a row for a key not seen yet", () => {
    const rows: Row[] = [{ device_id: 1, v: "a" }];
    const next = upsertById(rows, { device_id: 2, v: "b" }, (r) => r.device_id);
    expect(next).toEqual([{ device_id: 1, v: "a" }, { device_id: 2, v: "b" }]);
  });

  it("updates the matching row in place, leaving others untouched", () => {
    const rows: Row[] = [{ device_id: 1, v: "a" }, { device_id: 2, v: "b" }];
    const next = upsertById(rows, { device_id: 2, v: "b2" }, (r) => r.device_id);
    expect(next).toEqual([{ device_id: 1, v: "a" }, { device_id: 2, v: "b2" }]);
  });

  it("does not mutate the original array", () => {
    const rows: Row[] = [{ device_id: 1, v: "a" }];
    const next = upsertById(rows, { device_id: 1, v: "a2" }, (r) => r.device_id);
    expect(rows).toEqual([{ device_id: 1, v: "a" }]);
    expect(next).toEqual([{ device_id: 1, v: "a2" }]);
  });
});
