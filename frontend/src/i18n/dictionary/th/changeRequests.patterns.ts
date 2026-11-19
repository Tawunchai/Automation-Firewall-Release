/**
 * Thai — the interpolated sentences of the Change Requests queue.
 *
 * A translation may move the `{}` holes but may not change how many there are:
 * ../../dictionary.test.ts fails on that, because a dropped hole is a request id or a count missing
 * from the screen.
 */

import type { Dict } from "../merge";

export const changeRequestsPatterns: Dict = {
  // The accessible name of each row's Open button.
  "Open change request {}": "เปิดคำขอเปลี่ยนแปลง {}",
  // Shown only when the server's 500-row ceiling was reached.
  "Showing the newest {} requests — older ones are not listed":
    "แสดงคำขอใหม่สุด {} รายการ — รายการที่เก่ากว่าไม่ได้แสดง",
};
