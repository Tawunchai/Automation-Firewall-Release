import React from "react";

/**
 * The illustration beside the sign-in form.
 *
 * A scene, not an ornament. It reads left to right, in the direction traffic actually moves, and
 * every element is one of six actors or the evidence of what happened between them:
 *
 *   ATTACKERS (left)
 *     1. MALWARE FILE — the disguised payload, coming in over the top. A document with a folded
 *                   corner, a fanged grin and a warning badge: the threat that arrives looking
 *                   like something you asked for. It replaced a generic bug, which said "malware"
 *                   in the abstract while this console's File Filter profile blocks a *file*.
 *     2. VIRUS    — the spiky one, front and centre of the threat side.
 *     3. BOT/DDoS — the robot below, with two drones behind it, throwing a FAN of requests rather
 *                   than one. Volume is the whole point of that attack, so it is the only attacker
 *                   drawn with more than one line: three, converging on the same spot.
 *
 *   DEFENCE (middle)
 *     4. FIREWALL — the brick guard. It has a face because it is the protagonist, and its pupils
 *                   sit LEFT of centre so it is looking at what it is holding off. That one detail
 *                   is what makes the picture a single event rather than six drawings sharing a
 *                   canvas. Each attack stops dead at its left face under a red cross.
 *
 *   PROTECTED (right)
 *     5. CONSOLE  — the Web Application / Automation Firewall: this product. Inspected traffic
 *                   leaves the wall on a BLUE line and arrives here.
 *     6. SERVER   — reached last, on a green line from the console.
 *
 * Three colours carry the whole story and are used nowhere else in the drawing:
 * red/orange = stopped, blue = inspected and allowed through, green = safe.
 *
 * It lives in its own file because it is ~300 lines of geometry with no relationship to the login
 * logic next door, and because a page that is mostly `<path d>` is a page nobody can review.
 *
 * ── Implementation notes ─────────────────────────────────────────────────────
 *
 * Inline SVG rather than an image: it stays crisp at any width, costs no second request on a
 * console served next to the firewall itself, and the strokes that must invert for dark mode are
 * drawn in `currentColor`, so ONE text colour on the wrapper flips all of them. A PNG would need
 * two assets and would still band across these gradients.
 *
 * Repeated geometry — virus spikes, bug legs, brick courses, rack slots, chart bars — is generated
 * from small arrays rather than typed out. Twenty hand-written <line>s is exactly where a
 * symmetrical shape quietly stops being symmetrical.
 *
 * The two column centres (`wallMid`, `rightMid`) are derived, not repeated. Every face, badge and
 * arrow that has to sit on an axis reads it from there, so nudging a column moves its contents with
 * it instead of leaving one eye behind.
 *
 * The motion classes (`hero-float*`, `hero-pulse`, `hero-flow`) are defined next to the page's
 * other scoped CSS in index.tsx, together with the reduced-motion opt-out.
 */
const HeroArt: React.FC<{ className?: string }> = ({ className }) => {
  // ── Virus: ten evenly spaced stalks, each with a knob on the tip ───────────
  const virus = { cx: 142, cy: 250, r: 40, reach: 55 };
  const spikes = Array.from({ length: 10 }, (_, i) => {
    const a = (i * 36 * Math.PI) / 180;
    return {
      x1: virus.cx + virus.r * Math.cos(a),
      y1: virus.cy + virus.r * Math.sin(a),
      x2: virus.cx + virus.reach * Math.cos(a),
      y2: virus.cy + virus.reach * Math.sin(a),
    };
  });

  // ── Firewall: brick courses ───────────────────────────────────────────────
  //
  // The bricks are real rects over a darker bed, with a gap left around each one, so the mortar is
  // the background showing through. Ruling lines over a flat fill was the first attempt and it read
  // as a window pane: the depth comes from the bed being a different colour, not from the lines.
  //
  // Joints shift by half a brick on alternate courses. Without that stagger it is a grid.
  const wall = { x: 256, y: 140, w: 168, h: 270, rows: 6 };
  const wallMid = wall.x + wall.w / 2;
  const rowH = wall.h / wall.rows;
  const courses = Array.from({ length: wall.rows }, (_, r) => {
    const joints =
      r % 2 === 0
        ? [wall.x + wall.w / 3, wall.x + (wall.w * 2) / 3]
        : [wall.x + wall.w / 6, wall.x + wall.w / 2, wall.x + (wall.w * 5) / 6];
    // Edges → bricks. The half-bricks at the ends of an offset course are what sells the bond.
    const edges = [wall.x, ...joints, wall.x + wall.w];
    return {
      top: wall.y + r * rowH,
      bricks: edges.slice(0, -1).map((left, i) => ({ x: left, w: edges[i + 1] - left })),
    };
  });

  // ── Protected column: the console, and the server under it ────────────────
  const consoleBox = { x: 524, y: 150, w: 164, h: 132 };
  const rightMid = consoleBox.x + consoleBox.w / 2;

  // ── Malware file: a sheet of paper with the top-right corner turned down ──
  //
  // Every feature below is placed off this box rather than typed as a literal, for the same reason
  // the wall's face is placed off `wallMid`: the character has a face, two arms and a badge that
  // all have to move together, and a hand-numbered version leaves one of them behind the first
  // time the file is nudged.
  const file = { x: 72, y: 74, w: 62, h: 86, fold: 20 };
  const fileMid = file.x + file.w / 2;
  const fileBottom = file.y + file.h;
  // The silhouette: a rounded rect whose top-right corner is cut away on the diagonal, so the fold
  // flap drawn over it reads as the back of the page rather than as a sticker.
  const filePath =
    `M${file.x + 11} ${file.y}` +
    `h${file.w - file.fold - 11}` +
    `l${file.fold} ${file.fold}` +
    `v${file.h - file.fold - 11}` +
    `a11 11 0 0 1 -11 11` +
    `h${-(file.w - 22)}` +
    `a11 11 0 0 1 -11 -11` +
    `v${-(file.h - 22)}` +
    `a11 11 0 0 1 11 -11z`;

  // ── Where each attack is stopped ──────────────────────────────────────────
  // One badge per attacker, all on the wall's left face, so "blocked" is stated three times in the
  // same visual language instead of three different ones.
  const blockX = wall.x - 30;
  const blocks = [166, 238, 330];

  return (
    <svg
      viewBox="0 0 780 500"
      role="img"
      aria-label={
        "A brick firewall blocking a virus, a malicious file and a DDoS bot on the left, while " +
        "inspected traffic flows on to the automation console and the server it protects on the right"
      }
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* The backdrop wash: three radial gradients that fade to transparent on their own.
            It used to be one flat ellipse under a feGaussianBlur, which looked the same and cost
            considerably more — an SVG filter is re-run whenever anything in the tree repaints, and
            six animated groups repaint this tree constantly. Gradients are free. */}
        <radialGradient id="washA" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="washB" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7DA8FF" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#7DA8FF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="washC" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6EE7C7" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#6EE7C7" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wallFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6C97FF" />
          <stop offset="100%" stopColor="#3457D5" />
        </linearGradient>
        <linearGradient id="virusFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF8A75" />
          <stop offset="100%" stopColor="#E23D3D" />
        </linearGradient>
        {/* The malware file keeps the violet the bug it replaced was drawn in. The left of the
            panel is washed violet (washA), and the threat side needs three bodies that are
            obviously three different things — red, violet, slate — rather than three reds. */}
        <linearGradient id="fileFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#7C4DEB" />
        </linearGradient>
        <linearGradient id="botFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8496AE" />
          <stop offset="100%" stopColor="#3F4C61" />
        </linearGradient>
        <linearGradient id="rackFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E8F0FC" />
        </linearGradient>
        <pattern id="heroDots" width="13" height="13" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.7" fill="currentColor" opacity="0.28" />
        </pattern>
        <clipPath id="heroWallClip">
          <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} rx="16" />
        </clipPath>
      </defs>

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      {/* The dotted square and the two thin rings carry over from the original design: they set the
          panel's depth and are the only decoration allowed to run off the edges. */}
      <g className="text-slate-400 dark:text-white/30">
        <rect x="18" y="20" width="104" height="104" fill="url(#heroDots)" />
      </g>
      <g className="text-slate-300 dark:text-white/12" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="752" cy="340" r="152" />
        <circle cx="752" cy="340" r="216" />
      </g>
      {/* Three overlapping washes, offset from each other so the colour still travels violet →
          blue → mint across the panel the way the blurred single ellipse used to. */}
      <ellipse cx="300" cy="204" rx="278" ry="180" fill="url(#washA)" />
      <ellipse cx="392" cy="250" rx="300" ry="190" fill="url(#washB)" />
      <ellipse cx="486" cy="300" rx="286" ry="186" fill="url(#washC)" />

      {/* Contact shadows. Without them nothing has a floor and the whole scene hovers. */}
      <g fill="#0F1B33">
        <ellipse cx={wallMid} cy="424" rx="108" ry="15" opacity="0.1" />
        <ellipse cx={rightMid} cy="474" rx="74" ry="11" opacity="0.08" />
        <ellipse cx={virus.cx} cy="318" rx="50" ry="9" opacity="0.07" />
        <ellipse cx="112" cy="452" rx="46" ry="8" opacity="0.07" />
      </g>

      {/* ══ PROTECTED SIDE ═════════════════════════════════════════════════ */}

      {/* ── 5. CONSOLE — the Web Application / Automation Firewall ────────── */}
      {/* Drawn as what it is: this product's own screen. Browser chrome, a sidebar, a chart and a
          list — enough to be recognised as a console at 60% scale and not one detail more. */}
      <g className="hero-float-2">
        {/* Status mast. The console is the one object actively working, so it gets the second
            pulsing light in the picture (the firewall's badge is the first). */}
        <path d={`M${rightMid} ${consoleBox.y}v-18`} stroke="#C4D7F0" strokeWidth="3.5" strokeLinecap="round" />
        <circle className="hero-pulse" cx={rightMid} cy="126" r="10" fill="#34D399" opacity="0.3" />
        <circle cx={rightMid} cy="126" r="5" fill="#34D399" />

        <rect
          x={consoleBox.x} y={consoleBox.y} width={consoleBox.w} height={consoleBox.h} rx="15"
          fill="url(#rackFill)" stroke="#C9DAF0" strokeWidth="2"
        />
        {/* Window chrome */}
        {[
          { dx: 17, fill: "#F87171" },
          { dx: 29, fill: "#FBBF24" },
          { dx: 41, fill: "#34D399" },
        ].map((d) => (
          <circle key={d.dx} cx={consoleBox.x + d.dx} cy="167" r="3.6" fill={d.fill} />
        ))}
        <path d={`M${consoleBox.x} 180h${consoleBox.w}`} stroke="#DCE8FA" strokeWidth="2" />

        {/* Sidebar */}
        <rect x="536" y="192" width="34" height="76" rx="8" fill="#DCE8FA" />
        {[204, 218, 232].map((cy) => (
          <circle key={cy} cx="553" cy={cy} r="3.2" fill="#A9C3E8" />
        ))}

        {/* Chart panel */}
        <rect x="580" y="192" width="96" height="40" rx="8" fill="#EFF5FE" />
        {[12, 22, 16, 26, 19].map((h, i) => (
          <rect key={h} x={588 + i * 14} y={224 - h} width="9" height={h} rx="3" fill="#7DA8FF" />
        ))}

        {/* List panel */}
        <rect x="580" y="240" width="96" height="28" rx="8" fill="#EFF5FE" />
        <rect x="590" y="248" width="54" height="5.5" rx="2.75" fill="#B9CDEA" />
        <rect x="590" y="257" width="36" height="5.5" rx="2.75" fill="#CFDDF2" />

        {/* Badge: a bolt on the brand blue — automation, on the object that automates. */}
        <circle cx="678" cy="160" r="18" fill="#3457D5" stroke="#ffffff" strokeWidth="3" />
        <path d="M681 150l-9 12h6l-3 10 9-13h-6z" fill="#ffffff" />
      </g>

      {/* Console → server: the last hop, and the only green line in the picture. */}
      <g className="hero-flow" fill="none" stroke="#34D399" strokeWidth="3.5" strokeLinecap="round">
        <path d={`M${rightMid} 288v26`} />
      </g>
      <path d={`M${rightMid} 326l-7-11h14z`} fill="#34D399" />

      {/* ── 6. SERVER — what all of it is for ────────────────────────────── */}
      <g className="hero-float-3">
        <rect
          x="544" y="330" width="124" height="132" rx="13"
          fill="url(#rackFill)" stroke="#C9DAF0" strokeWidth="2"
        />
        {[344, 384, 424].map((y) => (
          <g key={y}>
            <rect x="558" y={y} width="96" height="28" rx="7" fill="#DCE8FA" />
            <circle cx="572" cy={y + 14} r="4.2" fill="#34D399" />
            <rect x="584" y={y + 11} width="42" height="6" rx="3" fill="#B9CDEA" />
          </g>
        ))}
        <circle cx="662" cy="336" r="16" fill="#34D399" />
        <path
          d="M655 336l5 5 10-11"
          fill="none" stroke="#ffffff" strokeWidth="3.2"
          strokeLinecap="round" strokeLinejoin="round"
        />
      </g>

      {/* ══ THE WALL ═══════════════════════════════════════════════════════ */}

      {/* Inspected traffic leaving the wall. The longest run in the picture on purpose: it is the
          one thing the scene is arguing FOR, and a two-dash stub would have read as an afterthought
          next to three lanes of attack. */}
      <g className="hero-flow" fill="none" stroke="#3B82F6" strokeWidth="3.5" strokeLinecap="round">
        <path d={`M${wall.x + wall.w + 4} 216h${consoleBox.x - wall.x - wall.w - 16}`} />
      </g>
      <path d={`M${consoleBox.x - 4} 216l-11-7v14z`} fill="#3B82F6" />

      {/* ── 4. FIREWALL — the guard ──────────────────────────────────────── */}
      <g>
        {/* Coping stone, so the wall has a top rather than simply stopping. */}
        <rect x={wall.x - 12} y="126" width={wall.w + 24} height="22" rx="10" fill="#2A47B8" />

        {/* Mortar bed, then the bricks on top of it, all clipped to the rounded silhouette so no
            course escapes a corner. */}
        <g clipPath="url(#heroWallClip)">
          <rect x={wall.x} y={wall.y} width={wall.w} height={wall.h} fill="#2A47B8" />
          {courses.map((c) =>
            c.bricks.map((b) => (
              <rect
                key={`${c.top}-${b.x}`}
                x={b.x + 3} y={c.top + 3}
                width={b.w - 6} height={rowH - 6}
                rx="5"
                fill="url(#wallFill)"
              />
            )),
          )}
          {/* One soft pass of shade up the wall, so the bottom courses sit back. */}
          <rect
            x={wall.x} y={wall.y + wall.h * 0.55} width={wall.w} height={wall.h * 0.45}
            fill="#12246B" opacity="0.12"
          />
        </g>
        <rect
          x={wall.x} y={wall.y} width={wall.w} height={wall.h} rx="16"
          fill="none" stroke="#2A47B8" strokeWidth="2"
        />

        {/* Face — see the header note on where the pupils point and why. */}
        <ellipse cx={wallMid - 26} cy="200" rx="14" ry="16" fill="#ffffff" />
        <ellipse cx={wallMid + 26} cy="200" rx="14" ry="16" fill="#ffffff" />
        <circle cx={wallMid - 31} cy="203" r="6.2" fill="#1E3A8A" />
        <circle cx={wallMid + 21} cy="203" r="6.2" fill="#1E3A8A" />
        <circle cx={wallMid - 28.5} cy="199" r="2" fill="#ffffff" />
        <circle cx={wallMid + 23.5} cy="199" r="2" fill="#ffffff" />
        <path
          d={`M${wallMid - 20} 230q20 15 40 0`}
          fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.9"
        />

        {/* Badge: a shield with a tick, breathing gently so the eye lands here first. */}
        <circle className="hero-pulse" cx={wallMid} cy="306" r="38" fill="#ffffff" opacity="0.16" />
        <path
          d={`M${wallMid} 274l31 11v22c0 19-13 32-31 39-18-7-31-20-31-39v-22z`}
          fill="#ffffff" stroke="#C9DAF0" strokeWidth="1.5"
        />
        <path
          d={`M${wallMid - 12} 308l9 9 16-18`}
          fill="none" stroke="#3457D5" strokeWidth="4.5"
          strokeLinecap="round" strokeLinejoin="round"
        />
      </g>

      {/* ══ THREAT SIDE ════════════════════════════════════════════════════ */}

      {/* ── 3. BOT / DDoS — the flood ────────────────────────────────────── */}
      {/* Two drones behind the big one. A botnet is a crowd, and one robot on its own reads as a
          single misbehaving client rather than as an attack. */}
      <g className="hero-float-2" fill="#94A3B8">
        <rect x="46" y="334" width="30" height="24" rx="8" />
        <circle cx="61" cy="346" r="4" fill="#F87171" />
        <path d="M61 334v-8" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="44" y="436" width="30" height="24" rx="8" />
        <circle cx="59" cy="448" r="4" fill="#F87171" />
        <path d="M59 436v-8" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
      </g>

      <g className="hero-float">
        {/* Antenna */}
        <path d="M112 340v-16" stroke="#3F4C61" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="112" cy="318" r="5.5" fill="#F87171" />
        {/* Arms and legs, behind the shell */}
        <g stroke="#3F4C61" strokeWidth="5.5" strokeLinecap="round">
          <path d="M84 392 62 402" />
          <path d="M140 392 162 402" />
          <path d="M98 420 96 438" />
          <path d="M126 420 128 438" />
          <path d="M87 440h18" />
          <path d="M119 440h18" />
        </g>
        {/* Head, visor, shell */}
        <rect x="88" y="340" width="48" height="38" rx="13" fill="#4B5A70" />
        <rect x="96" y="352" width="32" height="14" rx="7" fill="#F87171" />
        <circle cx="105" cy="359" r="2.6" fill="#FEE2E2" />
        <circle cx="119" cy="359" r="2.6" fill="#FEE2E2" />
        <rect x="84" y="376" width="56" height="46" rx="13" fill="url(#botFill)" />
        <circle cx="112" cy="396" r="6" fill="#F87171" opacity="0.85" />
        <rect x="98" y="408" width="28" height="5" rx="2.5" fill="#8496AE" />
      </g>

      {/* ── 2. VIRUS — front and centre of the threat side ───────────────── */}
      <g className="hero-float">
        <g stroke="#D93A3A" strokeWidth="6" strokeLinecap="round">
          {spikes.map((s) => (
            <line key={`s${s.x2}-${s.y2}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
          ))}
        </g>
        {spikes.map((s) => (
          <circle key={`k${s.x2}-${s.y2}`} cx={s.x2} cy={s.y2} r="6.5" fill="#D93A3A" />
        ))}
        <circle cx={virus.cx} cy={virus.cy} r={virus.r} fill="url(#virusFill)" />
        <circle cx={virus.cx - 16} cy={virus.cy - 16} r="7" fill="#ffffff" opacity="0.22" />
        <circle cx={virus.cx + 17} cy={virus.cy + 14} r="5" fill="#ffffff" opacity="0.16" />

        {/* Wide eyes and a downturned mouth — it is not having a good time. All placed off `virus`,
            so nudging the character moves its face with it. */}
        <ellipse cx={virus.cx - 12} cy={virus.cy - 6} rx="9" ry="10" fill="#ffffff" />
        <ellipse cx={virus.cx + 14} cy={virus.cy - 6} rx="9" ry="10" fill="#ffffff" />
        <circle cx={virus.cx - 10} cy={virus.cy - 4} r="4" fill="#7F1D1D" />
        <circle cx={virus.cx + 16} cy={virus.cy - 4} r="4" fill="#7F1D1D" />
        <path
          d={`M${virus.cx - 12} ${virus.cy + 17}q12-8 24 0`}
          fill="none" stroke="#7F1D1D" strokeWidth="3.4" strokeLinecap="round"
        />
      </g>

      {/* ── 1. MALWARE FILE — the disguised payload, coming in high ──────── */}
      {/* Read outside-in: arms, then the sheet, then what is printed on it. The two details that
          make it a *malicious* file rather than a document icon are the fanged grin and the warning
          badge clipped to its lower corner — everything else is deliberately an ordinary page. */}
      <g className="hero-float-3">
        {/* Arms. The right one is raised toward the wall: this is the attacker mid-lunge, and it is
            where the red run further down starts from. */}
        <g stroke="#5B21B6" strokeWidth="5.5" strokeLinecap="round" fill="none">
          <path d={`M${file.x + 2} 116 52 128`} />
          <path d={`M${file.x + file.w - 2} 114 152 100`} />
        </g>
        <circle cx="49" cy="130" r="5.5" fill="#5B21B6" />
        <circle cx="155" cy="98" r="5.5" fill="#5B21B6" />

        {/* The sheet, then the turned-down corner over it. The flap is a flat dark violet rather
            than a second gradient — one shade is all it takes to read as the back of the page, and
            two ramps meeting at a diagonal read as a crease instead of a fold. */}
        <path d={filePath} fill="url(#fileFill)" />
        <path
          d={`M${file.x + file.w - file.fold} ${file.y}v${file.fold}h${file.fold}z`}
          fill="#5B21B6"
        />

        {/* Brows, angled down toward the nose — the whole difference between a worried file and a
            hostile one, in two strokes. */}
        <g stroke="#4C1D95" strokeWidth="4" strokeLinecap="round">
          <path d={`M${fileMid - 22} 96 ${fileMid - 6} 100`} />
          <path d={`M${fileMid + 22} 96 ${fileMid + 6} 100`} />
        </g>

        {/* Eyes. Pupils sit 2px RIGHT of each eye's centre, like the virus's, so this attacker is
            looking at the wall it is about to hit rather than out of the picture. */}
        <ellipse cx={fileMid - 13} cy={file.y + 34} rx="8.5" ry="9.5" fill="#ffffff" />
        <ellipse cx={fileMid + 13} cy={file.y + 34} rx="8.5" ry="9.5" fill="#ffffff" />
        <circle cx={fileMid - 11} cy={file.y + 36} r="4" fill="#4C1D95" />
        <circle cx={fileMid + 15} cy={file.y + 36} r="4" fill="#4C1D95" />

        {/* An open, fanged grin. Filled rather than stroked so the fangs have something to hang
            from — a line mouth leaves them floating. */}
        <path d={`M${fileMid - 15} 127q15 16 30 0z`} fill="#4C1D95" />
        <path d={`M${fileMid - 6} 127l3.5 6 3.5-6z`} fill="#ffffff" />
        <path d={`M${fileMid + 2} 127l3.5 6 3.5-6z`} fill="#ffffff" />

        {/* Two lines of "text" below the face. Without them the shape is a pentagon; with them it
            is a document. */}
        <g fill="#EDE9FE" opacity="0.8">
          <rect x={fileMid - 17} y="143" width="28" height="5" rx="2.5" />
          <rect x={fileMid - 17} y="151" width="18" height="5" rx="2.5" />
        </g>

        {/* Warning badge on the lower corner — the one mark that names the file as dangerous
            without relying on the face being read at all. */}
        <circle cx={file.x + file.w} cy={fileBottom - 2} r="14" fill="#4C1D95" stroke="#ffffff" strokeWidth="3" />
        <path
          d={`M${file.x + file.w} ${fileBottom - 10.5}v8`}
          stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round"
        />
        <circle cx={file.x + file.w} cy={fileBottom + 6} r="1.9" fill="#ffffff" />
      </g>

      {/* ── The block ────────────────────────────────────────────────────── */}
      {/* Every attack is a dashed run that stops dead at the wall under a cross. The dashes travel;
          the crosses stay put. The bot gets three lines because volume IS its attack. */}
      <g className="hero-flow" fill="none" stroke="#EF4444" strokeWidth="3.5" strokeLinecap="round">
        {/* Leaves the malware file's RAISED hand, not its body: the lunge and the line it throws
            are the same gesture, and a run starting from the middle of the page read as a stray
            wire passing behind it. */}
        <path d={`M166 106C198 122 208 152 ${blockX - 4} 178`} />
        <path d={`M198 250h${blockX - 202}`} />
      </g>
      <g className="hero-flow" fill="none" stroke="#F97316" strokeWidth="3" strokeLinecap="round">
        <path d={`M148 362 ${blockX - 4} 336`} />
        <path d={`M148 386 ${blockX - 4} 344`} />
        <path d={`M148 410 ${blockX - 4} 352`} />
      </g>
      {blocks.map((y) => (
        <g key={y}>
          <rect
            x={blockX} y={y} width="26" height="26" rx="9"
            fill="#FEE2E2" stroke="#F7A8A8" strokeWidth="1.5"
          />
          <path
            d={`M${blockX + 8} ${y + 8}l10 10m0-10l-10 10`}
            fill="none" stroke="#DC2626" strokeWidth="3" strokeLinecap="round"
          />
        </g>
      ))}

      {/* ── Trim ─────────────────────────────────────────────────────────── */}
      {/* A padlock chip over the safe side and three sparks. Decoration only: nothing here carries
          meaning the scene has not already made. */}
      <g className="hero-float-3">
        <rect x="706" y="256" width="46" height="46" rx="14" fill="#ffffff" stroke="#D7E4F7" strokeWidth="2" />
        <path
          d="M721 277v-6a8 8 0 0116 0v6"
          fill="none" stroke="#3457D5" strokeWidth="3" strokeLinecap="round"
        />
        <rect x="718" y="277" width="22" height="16" rx="4" fill="#3457D5" />
      </g>
      <g className="text-[#7DA8FF] dark:text-white/45" fill="currentColor">
        <path d="M462 122l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
        <path d="M212 62l2.5 6.5 6.5 2.5-6.5 2.5-2.5 6.5-2.5-6.5-6.5-2.5 6.5-2.5z" />
        <path d="M480 452l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
      </g>
    </svg>
  );
};

export default HeroArt;
