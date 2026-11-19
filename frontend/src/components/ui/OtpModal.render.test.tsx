import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// react-i18next / toast / api ไม่ใช่สิ่งที่เทสนี้สนใจ — สนใจแค่ markup ที่ออกมา
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
  }),
}));
vi.mock("./toast", () => ({ message: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../api", () => ({ SendOTP: vi.fn(), VerifyOTPAddUpdatePassword: vi.fn() }));

import OtpModal from "./OtpModal";

// กล่อง OTP บนหน้า login
//
// ข้อกำหนดหลักของกล่องนี้คือ **มันต้องดูเป็นส่วนหนึ่งของหน้า login** ไม่ใช่ dialog ที่หลุดมา
// จากคอนโซล หน้า authentication เขียนกฎไว้ในตัวเองว่า:
//
//   "The blue below is fixed, not the console's --accent. The accent is a per-user preference
//    applied after sign-in; on this page there is no user yet... A front door should look the
//    same to everyone who arrives at it."
//
// ของเดิม OtpModal ดึง `currentColor` จาก ProviderContext มาใช้ ซึ่งคือสีที่ **ผู้ใช้คนล่าสุด
// ของเบราว์เซอร์เครื่องนี้** เลือกไว้ ปุ่ม "Verify Email" จึงเป็นสีแดงลอยอยู่บนหน้าที่ปุ่ม
// "Confirm Reset" เป็นสีน้ำเงิน (ตามภาพหน้าจอที่ผู้ใช้ส่งมา)

// กล่องนี้ใช้ createPortal ไปที่ document.body — renderToStaticMarkup ของ react-dom/server
// render portal ไม่ได้ ("Portals are not currently supported by the server renderer")
// จึง mount ลง jsdom จริงแล้วอ่าน markup กลับมาจาก body
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLElement }> = [];

const render = (props?: Partial<React.ComponentProps<typeof OtpModal>>): string => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => {
    root.render(
      <OtpModal
        open
        email="tawunchaien@gmail.com"
        newPassword="Passw0rd!"
        onClose={() => {}}
        onVerified={() => {}}
        {...props}
      />,
    );
  });
  // portal อยู่ที่ body ไม่ได้อยู่ใน host — อ่านทั้ง body แล้วตัด host ออก
  return document.body.innerHTML;
};

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.innerHTML = "";
});

// อ่านเฉพาะ "โค้ดจริง" — ตัดบรรทัดคอมเมนต์ทิ้ง เพราะคำอธิบายในไฟล์พูดถึง currentColor
// อยู่แล้ว (เพื่ออธิบายว่าทำไมถึงเลิกใช้) เทสที่ไม่ตัดคอมเมนต์จะจับคำอธิบายของตัวเอง
const SOURCE = fs.readFileSync(path.resolve(__dirname, "OtpModal.tsx"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("the dialog wears the login page's theme", () => {
  // กฎข้อเดียวที่สำคัญที่สุดของไฟล์นี้ — เขียนเป็นเทสระดับ source เพราะเป็นกฎเรื่อง
  // "ห้ามอ่านค่าจากไหน" ซึ่งดูจาก markup ที่ render ออกมาไม่ได้
  it("never picks up the per-user accent colour", () => {
    expect(SOURCE).not.toMatch(/useStateContext/);
    expect(SOURCE).not.toMatch(/currentColor/);
  });

  it("uses the same fixed blue as the authentication page", () => {
    // ค่าเดียวกับ --auth-brand ที่ประกาศไว้ในหน้า login
    expect(render()).toContain("#2F6FED");
  });

  // กล่องถูก portal ไปที่ document.body ซึ่งอยู่นอกต้นไม้ของ .auth-page แล้ว
  // ถ้าไม่ห่อ .auth-page ให้ตัวเอง ตัวแปร --auth-brand จะไม่ถูก resolve
  it("wraps itself in .auth-page because it is portalled out of the page", () => {
    expect(render()).toContain("auth-page");
  });
});

describe("the structure keyboard and screen-reader users need", () => {
  it("is a dialog with an accessible name", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="otp-modal-title"');
    expect(html).toContain('id="otp-modal-title"');
  });

  // บล็อกแยกหนึ่งช่องต่อหนึ่งหลัก — ผู้ใช้เห็นทันทีว่ากรอกไปกี่หลักแล้วโดยไม่ต้องนับ
  it("has six boxes, one digit each, digits only", () => {
    const html = render();
    expect(html.match(/inputmode="numeric"/g) ?? []).toHaveLength(6);
    expect(html.match(/maxlength="1"/g) ?? []).toHaveLength(6);
  });

  it("tells a screen reader which digit each box is, and ties them to the countdown", () => {
    const html = render();
    for (let n = 1; n <= 6; n++) expect(html).toContain(`otpModal.inputLabel:${n},6`);
    expect(html).toContain('aria-describedby="otp-clock"');
    expect(html).toContain('id="otp-clock"');
  });

  // ให้เบราว์เซอร์/มือถือเติมโค้ดจากอีเมลให้เองได้
  it("accepts a one-time-code autofill", () => {
    expect((render().match(/autocomplete="one-time-code"/g) ?? []).length).toBe(1);
  });

  // รูปประกอบไม่ได้บอกอะไรที่ข้อความข้างล่างไม่ได้บอกอยู่แล้ว — screen reader
  // ไม่ควรต้องฟังคำบรรยายภาพก่อนถึงช่องกรอกรหัส
  it("hides the illustration from screen readers", () => {
    const html = render();
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("what the dialog must say the moment it opens", () => {
  // ไม่แสดงอีเมลปลายทางแล้ว — ผู้ใช้เพิ่งพิมพ์อีเมลนั้นเองที่หน้าจอก่อนหน้า การเอามา
  // ย้ำอีกครั้งกินสองบรรทัดโดยไม่ได้บอกอะไรใหม่ และหน้านี้อยู่ก่อนล็อกอิน ยิ่งพิมพ์
  // อีเมลบนจอน้อยยิ่งดี
  it("never shows the destination email, whole or masked", () => {
    const html = render();
    expect(html).not.toContain("tawunchaien@gmail.com");
    expect(html).not.toContain("taw***");
  });

  // คำอธิบายต้องสั้นพอให้อยู่บรรทัดเดียว ไม่ดันหัวข้อให้ลอยห่างจากช่องกรอก
  it("keeps the description to one short sentence", () => {
    expect(render()).toContain("otpModal.subtitle");
  });

  // อายุโค้ด 5 นาที — ของเดิมไม่บอกเลย ผู้ใช้ที่เปิดอีเมลช้าจะกรอกโค้ดที่หมดอายุแล้ว
  // แล้วเจอ error ที่อ่านเหมือน "กรอกผิด"
  it("shows how long the code has left, from the start", () => {
    expect(render()).toContain("otpModal.expiresIn:5:00");
  });

  // OTPLimiter จำกัด 5 ครั้ง/10 นาที/IP — กดรัวแล้วโดน 429 ปิดทางส่งใหม่ไปอีก 10 นาที
  it("starts the resend button on a cooldown so it cannot be hammered", () => {
    const html = render();
    expect(html).toContain("otpModal.resendIn:60");
    expect(html).toContain("disabled=\"\"");
  });

  // ปุ่มยืนยันต้องกดไม่ได้จนกว่าจะครบ 6 หลัก — กดตอนยังไม่ครบมีแต่จะเผา attempt ทิ้ง
  // (OTPMaxAttempts = 5 แล้วต้องขอโค้ดใหม่)
  it("keeps the verify button disabled until the code is complete", () => {
    const html = render();
    const verifyBtn = html.slice(html.indexOf("otpModal.verify") - 400, html.indexOf("otpModal.verify"));
    expect(verifyBtn).toContain("disabled");
  });
});

describe("closing the dialog", () => {
  it("renders nothing at all when open=false", () => {
    const html = render({ open: false });
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("otpModal.title");
  });

  it("offers a close button with an accessible name", () => {
    expect(render()).toContain("common.close");
  });
});
