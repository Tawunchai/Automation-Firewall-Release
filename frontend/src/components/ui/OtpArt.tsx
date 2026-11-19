import React from "react";

/**
 * ภาพประกอบหัวกล่อง OTP — กำแพงไฟถือรหัสที่ส่งมาทางโทรศัพท์
 *
 * ── ทำไมเป็นกำแพงไฟ ไม่ใช่คน ─────────────────────────────────────────────────
 * ดีไซน์ต้นแบบวาดเป็นคนนั่งกับโทรศัพท์ แต่คอนโซลนี้มีมาสคอตอยู่แล้วหนึ่งตัว —
 * **กำแพงอิฐมีหน้า** ที่ยืนกันการโจมตีอยู่ข้างฟอร์ม login (ดู HeroArt.tsx) การใส่คน
 * เข้ามาอีกตัวจะกลายเป็นสองตัวละครในผลิตภัณฑ์เดียวกันที่ไม่รู้จักกัน
 *
 * รูปนี้จึงเป็น "ฉากต่อ" ของ HeroArt: กำแพงตัวเดิม ท่าเดิม สีเดิม แต่คราวนี้มันชี้ไปที่
 * โทรศัพท์ที่รหัสถูกส่งไป เรขาคณิตของตัวละครยกมาจาก HeroArt ทั้งหมด (อิฐสลับแนว,
 * ตาขาวทรงรี, ม่านตา #1E3A8A, ยิ้มเป็นเส้นขาว) เพื่อให้อ่านออกว่าเป็นตัวเดียวกัน
 *
 * ── สี ───────────────────────────────────────────────────────────────────────
 * ล็อกไว้ที่ตระกูล --auth-brand เท่านั้น ไม่แตะ accent ของผู้ใช้ ด้วยเหตุผลเดียวกับ
 * ที่เขียนไว้ในหัว OtpModal.tsx — หน้านี้อยู่ก่อนล็อกอิน ยังไม่มี "ผู้ใช้" ให้เอาสีมาใช้
 *
 * เส้นที่ต้องกลับสีในโหมดมืดวาดด้วย `currentColor` ตัวเดียว สลับสีที่ตัวห่อครั้งเดียวจบ
 * (วิธีเดียวกับ HeroArt) ส่วน `aria-hidden` เพราะรูปนี้ไม่ได้บอกอะไรที่ข้อความข้างล่าง
 * ไม่ได้บอกอยู่แล้ว — screen reader ไม่ควรต้องฟังคำบรรยายภาพก่อนถึงช่องกรอกรหัส
 */
const OtpArt: React.FC<{ className?: string }> = ({ className }) => {
  // ── กำแพง: อิฐสลับแนวแบบเดียวกับ HeroArt ────────────────────────────────
  // ก่ออิฐจริง ๆ (rect ซ้อนบนพื้นเข้ม เว้นร่องปูน) ไม่ใช่ลายเส้นตาราง และเลื่อนรอยต่อ
  // ครึ่งก้อนสลับแถว — ถ้าไม่เลื่อน มันคือกริด ไม่ใช่กำแพง
  const wall = { x: 26, y: 62, w: 86, h: 84, rows: 4 };
  const wallMid = wall.x + wall.w / 2;
  const rowH = wall.h / wall.rows;
  const courses = Array.from({ length: wall.rows }, (_, r) => {
    const joints =
      r % 2 === 0
        ? [wall.x + wall.w / 3, wall.x + (wall.w * 2) / 3]
        : [wall.x + wall.w / 6, wall.x + wall.w / 2, wall.x + (wall.w * 5) / 6];
    const edges = [wall.x, ...joints, wall.x + wall.w];
    return {
      top: wall.y + r * rowH,
      bricks: edges.slice(0, -1).map((left, i) => ({ x: left, w: edges[i + 1] - left })),
    };
  });

  // ── โทรศัพท์ที่รหัสถูกส่งไป ─────────────────────────────────────────────
  const phone = { x: 150, y: 22, w: 78, h: 132 };
  const phoneMid = phone.x + phone.w / 2;

  // ── ชิป OTP ที่ลอยทับจอ — 4 ช่อง สองช่องแรกกรอกแล้ว ────────────────────
  // กรอกไม่ครบโดยตั้งใจ: รูปนี้อยู่เหนือช่องกรอกที่ผู้ใช้กำลังจะพิมพ์ มันจึงควรแสดง
  // "กำลังกรอก" ไม่ใช่ "กรอกเสร็จแล้ว"
  const chip = { x: 118, y: 84, w: 104, h: 34 };
  const slots = Array.from({ length: 4 }, (_, i) => ({
    x: chip.x + 11 + i * 21,
    filled: i < 2,
  }));

  return (
    <svg
      viewBox="0 0 250 170"
      role="presentation"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="otpWallBed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3E63DD" />
          <stop offset="100%" stopColor="#2A47B8" />
        </linearGradient>
        <linearGradient id="otpBrick" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6E8BEE" />
          <stop offset="100%" stopColor="#4A6BDE" />
        </linearGradient>
        <linearGradient id="otpScreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8AA6F5" />
          <stop offset="100%" stopColor="#5C7CE8" />
        </linearGradient>
        <clipPath id="otpWallClip">
          <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} rx="10" />
        </clipPath>
      </defs>

      {/* ── ฉากหลัง: วงกลมจาง ๆ สองวง ให้ภาพมีระยะ ไม่ลอยบนกระดาษเปล่า ──── */}
      <g className="text-slate-300 dark:text-white/12" fill="none" stroke="currentColor" strokeWidth="1.1">
        <circle cx="196" cy="72" r="60" />
        <circle cx="196" cy="72" r="82" />
      </g>

      {/* เงาที่พื้น — ไม่มีสิ่งนี้ทุกอย่างจะลอยอยู่กลางอากาศ */}
      <g fill="#0F1B33">
        <ellipse cx={wallMid} cy="150" rx="48" ry="7" opacity="0.10" />
        <ellipse cx={phoneMid} cy="158" rx="34" ry="6" opacity="0.08" />
      </g>

      {/* ── โทรศัพท์ ───────────────────────────────────────────────────────── */}
      <g>
        <rect
          x={phone.x} y={phone.y} width={phone.w} height={phone.h} rx="13"
          fill="#EDF1FB" stroke="#C6D3EE" strokeWidth="2"
        />
        <rect
          x={phone.x + 5} y={phone.y + 5} width={phone.w - 10} height={phone.h - 10} rx="9"
          fill="url(#otpScreen)"
        />
        {/* ลำโพงบน + ปุ่มล่าง — สองอย่างที่ทำให้สี่เหลี่ยมมนอ่านว่าเป็นโทรศัพท์ */}
        <rect x={phoneMid - 9} y={phone.y + 11} width="18" height="3" rx="1.5" fill="#DCE5F8" opacity="0.85" />
        <rect x={phoneMid - 11} y={phone.y + phone.h - 15} width="22" height="3" rx="1.5" fill="#DCE5F8" opacity="0.6" />
        {/* บรรทัดข้อความจาง ๆ บนจอ ใต้ชิป — บอกว่าเป็นข้อความที่ส่งเข้ามา */}
        <g fill="#FFFFFF" opacity="0.42">
          <rect x={phone.x + 15} y={phone.y + 96} width="48" height="4" rx="2" />
          <rect x={phone.x + 15} y={phone.y + 106} width="34" height="4" rx="2" />
        </g>
      </g>

      {/* ── กำแพงไฟ: มาสคอตตัวเดียวกับหน้า login ──────────────────────────── */}
      <g>
        {/* แขนชี้ไปที่โทรศัพท์ — รายละเอียดเดียวที่ทำให้สองสิ่งนี้เป็นเหตุการณ์เดียวกัน
            ไม่ใช่ภาพสองภาพวางข้างกัน
            วางไว้ใต้ชิป OTP (ชิปจบที่ y=118) ไม่ใช่ระดับเดียวกัน — ชิปถูกวาดทีหลังและจะบัง
            แขนไปเกือบทั้งเส้น เหลือให้เห็นสั้นจนอ่านไม่ออกว่าเป็นแขน */}
        <path
          d={`M${wall.x + wall.w - 4} 124q18 5 28 -5`}
          fill="none" stroke="#2A47B8" strokeWidth="7" strokeLinecap="round"
        />

        <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} rx="10" fill="url(#otpWallBed)" />
        <g clipPath="url(#otpWallClip)">
          {courses.flatMap((c) =>
            c.bricks.map((b) => (
              <rect
                key={`${c.top}-${b.x}`}
                x={b.x + 2} y={c.top + 2}
                width={b.w - 4} height={rowH - 4}
                rx="3"
                fill="url(#otpBrick)"
              />
            )),
          )}
          {/* เงาไล่ขึ้น ให้แถวล่างถอยหลัง */}
          <rect x={wall.x} y={wall.y + wall.h * 0.58} width={wall.w} height={wall.h * 0.42} fill="#12246B" opacity="0.12" />
        </g>
        <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} rx="10" fill="none" stroke="#2A47B8" strokeWidth="1.6" />

        {/* หน้า — ม่านตาเยื้องไปทางขวา เพราะมันกำลังมองโทรศัพท์
            (ใน HeroArt ม่านตาเยื้องซ้ายเพราะกำลังมองผู้บุกรุก) */}
        <ellipse cx={wallMid - 14} cy="88" rx="7.5" ry="8.5" fill="#ffffff" />
        <ellipse cx={wallMid + 14} cy="88" rx="7.5" ry="8.5" fill="#ffffff" />
        <circle cx={wallMid - 11.5} cy="89.5" r="3.3" fill="#1E3A8A" />
        <circle cx={wallMid + 16.5} cy="89.5" r="3.3" fill="#1E3A8A" />
        <circle cx={wallMid - 10.5} cy="87.5" r="1.1" fill="#ffffff" />
        <circle cx={wallMid + 17.5} cy="87.5" r="1.1" fill="#ffffff" />
        <path
          d={`M${wallMid - 10} 104q10 8 20 0`}
          fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity="0.9"
        />

        {/* โล่ติ๊กถูกที่อก — เครื่องหมายเดียวกับที่กำแพงใน HeroArt ใส่ไว้
            ปลายโล่ต้องจบเหนือขอบล่างของกำแพง (y=146) ไม่งั้นมันจะยื่นลงไปทับเงาที่พื้น
            แล้วอ่านเหมือนโล่หล่นอยู่ข้างตัว ไม่ใช่ติดอยู่ที่อก */}
        <path
          d={`M${wallMid} 110l13 4.5v9.5c0 8-5.5 13-13 16.5-7.5-3.5-13-8.5-13-16.5v-9.5z`}
          fill="#ffffff" stroke="#C9DAF0" strokeWidth="1"
        />
        <path
          d={`M${wallMid - 5.5} 124l4 4 7-8`}
          fill="none" stroke="#3457D5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        />
      </g>

      {/* ── ชิป OTP ลอยทับจอ ──────────────────────────────────────────────── */}
      <g>
        <rect
          x={chip.x} y={chip.y} width={chip.w} height={chip.h} rx="8"
          fill="#FFFFFF" stroke="#D5DFF5" strokeWidth="1.6"
        />
        {slots.map((s) => (
          <g key={s.x}>
            <rect
              x={s.x} y={chip.y + 8} width="15" height="18" rx="3.5"
              fill={s.filled ? "#EAF0FE" : "#FFFFFF"}
              stroke={s.filled ? "#2F6FED" : "#DDE4F3"}
              strokeWidth="1.3"
            />
            {s.filled && <circle cx={s.x + 7.5} cy={chip.y + 17} r="3" fill="#2F6FED" />}
          </g>
        ))}
      </g>

      {/* ── กุญแจลอยสองดอก: บอกว่าเรื่องนี้คือเรื่องความปลอดภัย โดยไม่ต้องมีข้อความ ── */}
      {[{ x: 12, y: 30 }, { x: 116, y: 44 }].map((p, i) => (
        <g key={p.x} transform={`translate(${p.x} ${p.y}) scale(${i === 0 ? 1 : 0.78})`}>
          <rect width="26" height="26" rx="8" fill="#E5EDFC" />
          <path
            d="M9 13v-2.5a4 4 0 0 1 8 0V13"
            fill="none" stroke="#2F6FED" strokeWidth="2" strokeLinecap="round"
          />
          <rect x="7.5" y="12.5" width="11" height="9" rx="2.5" fill="#2F6FED" />
        </g>
      ))}
    </svg>
  );
};

export default OtpArt;
