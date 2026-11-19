import React from "react";

/**
 * มาสคอตของหน้า Notify — ฟองแชทสีเขียว LINE ถือโล่ของ firewall
 *
 * ── ทำไมวาดเอง ไม่ใช้ตัวการ์ตูนของ LINE ─────────────────────────────────────
 * ตัวละครทางการของ LINE (Brown, Cony ฯลฯ) เป็นงานมีลิขสิทธิ์ของ LY Corporation
 * เอามาวาดใส่ผลิตภัณฑ์ไม่ได้ ถึงจะวาดใหม่เองก็ตาม รูปนี้จึงเป็นตัวละครของเราเอง —
 * ฟองแชทมีหน้า — ที่สื่อถึง LINE ผ่าน **สีเขียวแบรนด์ (#06C755) กับทรงฟองแชท**
 * ซึ่งเป็นสิ่งที่ใช้ได้ ไม่ใช่ผ่านตัวการ์ตูนของเขา
 *
 * โล่ที่มันถืออยู่คือของที่ยืมมาจากมาสคอตกำแพงไฟของคอนโซลนี้ (HeroArt / OtpArt) —
 * หน้านี้คือ "firewall ส่งข่าวเข้า LINE" ไม่ใช่แอปแชททั่วไป รูปจึงต้องพูดสองอย่างพร้อมกัน
 *
 * `aria-hidden` เพราะข้อความข้างล่างบอกครบอยู่แล้ว screen reader ไม่ควรต้องฟังคำบรรยายภาพก่อน
 */
const LineMascot: React.FC<{ className?: string }> = ({ className }) => {
  // ฟองแชท: สี่เหลี่ยมมน + หางชี้ลงซ้าย วาดเป็น path เดียวเพื่อให้เงาและขอบต่อเนื่องกัน
  const bubble = { x: 26, y: 18, w: 116, h: 92, r: 26 };
  const mid = bubble.x + bubble.w / 2;

  return (
    <svg
      viewBox="0 0 200 150"
      role="presentation"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="lineBubble" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22D96A" />
          <stop offset="100%" stopColor="#06C755" />
        </linearGradient>
      </defs>

      {/* วงกลมจาง ๆ ด้านหลัง ให้ภาพมีระยะ ไม่ลอยบนกระดาษเปล่า */}
      <g className="text-slate-300 dark:text-white/12" fill="none" stroke="currentColor" strokeWidth="1.1">
        <circle cx="120" cy="62" r="58" />
        <circle cx="120" cy="62" r="80" />
      </g>

      {/* เงาที่พื้น */}
      <ellipse cx={mid} cy="132" rx="46" ry="7" fill="#0F1B33" opacity="0.10" />

      {/* ── ฟองแชท ── */}
      <path
        d={
          `M${bubble.x + bubble.r} ${bubble.y}` +
          `h${bubble.w - bubble.r * 2}` +
          `a${bubble.r} ${bubble.r} 0 0 1 ${bubble.r} ${bubble.r}` +
          `v${bubble.h - bubble.r * 2}` +
          `a${bubble.r} ${bubble.r} 0 0 1 ${-bubble.r} ${bubble.r}` +
          `h${-(bubble.w - bubble.r * 2 - 26)}` +
          // หางฟองแชท — สิ่งเดียวที่ทำให้สี่เหลี่ยมมนอ่านว่าเป็น "ข้อความ" ไม่ใช่ "การ์ด"
          `l-16 18l-2 -18h-8` +
          `a${bubble.r} ${bubble.r} 0 0 1 ${-bubble.r} ${-bubble.r}` +
          `v${-(bubble.h - bubble.r * 2)}` +
          `a${bubble.r} ${bubble.r} 0 0 1 ${bubble.r} ${-bubble.r}z`
        }
        fill="url(#lineBubble)"
      />

      {/* หน้า — ตาเยื้องขวาเล็กน้อย กำลังมองกระดิ่งที่เพิ่งดัง */}
      <ellipse cx={mid - 20} cy="54" rx="8" ry="9.5" fill="#ffffff" />
      <ellipse cx={mid + 16} cy="54" rx="8" ry="9.5" fill="#ffffff" />
      <circle cx={mid - 17.5} cy="55.5" r="3.6" fill="#0B5D2E" />
      <circle cx={mid + 18.5} cy="55.5" r="3.6" fill="#0B5D2E" />
      <circle cx={mid - 16.5} cy="53.5" r="1.2" fill="#ffffff" />
      <circle cx={mid + 19.5} cy="53.5" r="1.2" fill="#ffffff" />
      <path
        d={`M${mid - 12} 72q12 10 24 0`}
        fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.92"
      />

      {/* ── โล่ติ๊กถูก: ตัวเชื่อมกับมาสคอตกำแพงไฟของคอนโซล ──
          บอกว่าข้อความที่ส่งมาคือเรื่องความปลอดภัย ไม่ใช่แชททั่วไป */}
      <g transform="translate(126 74)">
        <path d="M18 0l17 6v13c0 11-7 18-17 22-10-4-17-11-17-22V6z" fill="#ffffff" stroke="#CBE8D6" strokeWidth="1.2" />
        <path d="M11 19l5 5 9-10" fill="none" stroke="#06C755" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* ── กระดิ่งแจ้งเตือนลอยมุมบน + เส้นสั่นสองข้าง ── */}
      <g transform="translate(146 12)">
        <rect width="30" height="30" rx="10" fill="#E6F9EE" />
        <path
          d="M15 8a5 5 0 0 0-5 5v4l-2 3h14l-2-3v-4a5 5 0 0 0-5-5z"
          fill="#06C755"
        />
        <path d="M13 21a2 2 0 0 0 4 0" fill="none" stroke="#06C755" strokeWidth="1.8" strokeLinecap="round" />
      </g>
      <g stroke="#06C755" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.45">
        <path d="M182 20q4 7 0 14" />
        <path d="M142 20q-4 7 0 14" />
      </g>
    </svg>
  );
};

export default LineMascot;
