import React from "react";

/**
 * มาสคอตของหน้า Credentials — กุญแจมีหน้า ยืนอยู่หน้าตู้เซฟ
 *
 * ── ทำไมเป็นกุญแจ + ตู้เซฟ ไม่ใช่แค่ไอคอนแม่กุญแจ ────────────────────────────
 * หน้านี้พูดถึงของสองอย่างที่ต่างกัน และรูปต้องแยกมันออกจากกัน:
 *
 *   ตู้เซฟ  = รหัสผ่านของอุปกรณ์ที่ถูกเข้ารหัสเก็บไว้ (AES-GCM ใน network_devices.password_enc)
 *   กุญแจ   = CRED_ENC_KEY ที่ใช้เปิดตู้ — คนละอย่างกับของที่อยู่ข้างใน และเป็นตัวที่ต้องหมุนเปลี่ยน
 *
 * ไอคอนแม่กุญแจเฉย ๆ สื่อได้แค่ "ล็อกอยู่" ซึ่งไม่ใช่ประเด็นของหน้านี้
 *
 * เส้นวงจรจาง ๆ ด้านหลังคือส่วน "cyber" — วางไว้เป็นฉากหลังไม่ให้แย่งสายตากับตัวละคร
 * และโล่ติ๊กถูกที่มุมคือของที่ยืมมาจากมาสคอตกำแพงไฟของคอนโซล (HeroArt / OtpArt / LineMascot)
 * เพื่อให้ทั้งระบบใช้ตัวละครตระกูลเดียวกัน ไม่ใช่ภาพประกอบคนละแอปมากองรวมกัน
 *
 * `aria-hidden` เพราะข้อความข้างล่างบอกครบอยู่แล้ว
 */
const KeyMascot: React.FC<{ className?: string }> = ({ className }) => {
  // ── ตู้เซฟ ────────────────────────────────────────────────────────────────
  const vault = { x: 104, y: 26, w: 78, h: 98 };
  const vaultMid = vault.x + vault.w / 2;

  // ── ตัวกุญแจ: หัวกลมมีหน้า + ก้านชี้ไปทางตู้ + เดือยสองซี่ที่ปลาย ────────
  const head = { cx: 46, cy: 74, r: 27 };
  const shaft = { x: head.cx + 20, y: head.cy - 7, w: 44, h: 14 };

  // เส้นวงจรฉากหลัง — จุดปลายทุกเส้นอยู่ในกรอบ 200x150 ทั้งหมด
  const traces = [
    { d: "M8 34h22a6 6 0 0 1 6 6v10", cx: 8, cy: 34 },
    { d: "M12 122h30a6 6 0 0 0 6-6v-8", cx: 12, cy: 122 },
    { d: "M192 46h-14a6 6 0 0 0-6 6v6", cx: 192, cy: 46 },
  ];

  return (
    <svg
      viewBox="0 0 200 150"
      role="presentation"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="credVault" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6D7FF3" />
          <stop offset="100%" stopColor="#4553C8" />
        </linearGradient>
        <linearGradient id="credKey" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FBC24A" />
          <stop offset="100%" stopColor="#EFA315" />
        </linearGradient>
      </defs>

      {/* ── ฉากหลัง: วงแหวนจาง ๆ + เส้นวงจร ── */}
      <g className="text-slate-300 dark:text-white/12" fill="none" stroke="currentColor" strokeWidth="1.1">
        <circle cx={vaultMid} cy="70" r="62" />
      </g>
      <g className="text-indigo-300 dark:text-indigo-400/25" fill="none" stroke="currentColor" strokeWidth="1.4">
        {traces.map((t) => (
          <g key={t.d}>
            <path d={t.d} />
            <circle cx={t.cx} cy={t.cy} r="2.6" fill="currentColor" stroke="none" />
          </g>
        ))}
      </g>

      {/* เงาที่พื้น — ไม่มีสิ่งนี้ทุกอย่างจะลอยกลางอากาศ */}
      <g fill="#0F1B33">
        <ellipse cx={vaultMid} cy="130" rx="42" ry="6" opacity="0.10" />
        <ellipse cx={head.cx} cy="112" rx="30" ry="5" opacity="0.08" />
      </g>

      {/* ── ตู้เซฟ ── */}
      <g>
        <rect x={vault.x} y={vault.y} width={vault.w} height={vault.h} rx="14" fill="url(#credVault)" />
        {/* ขอบในของประตู — ทำให้อ่านว่าเป็น "ประตู" ไม่ใช่กล่องทึบ */}
        <rect
          x={vault.x + 8} y={vault.y + 8} width={vault.w - 16} height={vault.h - 16} rx="9"
          fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.34"
        />
        {/* รูกุญแจ */}
        <circle cx={vaultMid} cy="66" r="10" fill="#ffffff" opacity="0.92" />
        <path d={`M${vaultMid - 4} 72h8l-2.5 15h-3z`} fill="#ffffff" opacity="0.92" />
        {/* บานพับสองจุดที่ขอบขวา */}
        <g fill="#ffffff" opacity="0.28">
          <rect x={vault.x + vault.w - 6} y={vault.y + 22} width="4" height="12" rx="2" />
          <rect x={vault.x + vault.w - 6} y={vault.y + vault.h - 34} width="4" height="12" rx="2" />
        </g>
      </g>

      {/* ── กุญแจ ── */}
      <g>
        {/* ก้าน + เดือย วาดก่อนหัว เพื่อให้หัวทับรอยต่อ */}
        <rect x={shaft.x} y={shaft.y} width={shaft.w} height={shaft.h} rx="7" fill="url(#credKey)" />
        <g fill="url(#credKey)">
          <rect x={shaft.x + shaft.w - 26} y={shaft.y + shaft.h - 2} width="7" height="12" rx="3" />
          <rect x={shaft.x + shaft.w - 13} y={shaft.y + shaft.h - 2} width="7" height="16" rx="3" />
        </g>

        <circle cx={head.cx} cy={head.cy} r={head.r} fill="url(#credKey)" />
        {/* รูตรงกลางหัวกุญแจ วาดเป็นวงแหวน ไม่ใช่รูทะลุ เพราะหน้าอยู่ตรงนี้ */}
        <circle cx={head.cx} cy={head.cy} r={head.r - 6} fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.32" />

        {/* หน้า — ตาเยื้องขวา กำลังมองตู้เซฟที่ตัวเองจะไปเปิด
            (ทิศทางสายตาคือสิ่งเดียวที่ทำให้สองชิ้นนี้เป็นเหตุการณ์เดียวกัน) */}
        <ellipse cx={head.cx - 8} cy={head.cy - 4} rx="6" ry="7.5" fill="#ffffff" />
        <ellipse cx={head.cx + 9} cy={head.cy - 4} rx="6" ry="7.5" fill="#ffffff" />
        <circle cx={head.cx - 6} cy={head.cy - 2.5} r="2.8" fill="#7A4E06" />
        <circle cx={head.cx + 11} cy={head.cy - 2.5} r="2.8" fill="#7A4E06" />
        <circle cx={head.cx - 5} cy={head.cy - 4.5} r="1" fill="#ffffff" />
        <circle cx={head.cx + 12} cy={head.cy - 4.5} r="1" fill="#ffffff" />
        <path
          d={`M${head.cx - 8} ${head.cy + 10}q8 7 16 0`}
          fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" opacity="0.92"
        />
      </g>

      {/* ── โล่ติ๊กถูก: ตัวเชื่อมกับมาสคอตอื่นของคอนโซล ── */}
      <g transform="translate(150 96)">
        <path d="M16 0l15 5v12c0 10-6 16-15 20-9-4-15-10-15-20V5z" fill="#ffffff" stroke="#CBD5F0" strokeWidth="1.2" />
        <path d="M9.5 17l4.5 4.5 8-9" fill="none" stroke="#4553C8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
};

export default KeyMascot;
