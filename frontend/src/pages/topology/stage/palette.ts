// The stage's colour contract: one meaning per colour, in both themes.
//
// The old ring painted almost everything the same grey and then used colour for three different
// jobs at once, so green could mean "link up", "permitted" or "healthy" depending where you
// looked. Here each entry below has exactly one job, and anything without a job stays neutral —
// which is what makes the lit parts readable at all.

export type Mode = "light" | "dark";

export type StagePalette = {
  /** Lighting has to differ per theme: the same rig that reads as daylight on a white floor
   *  washes a dark palette out until the tiles come back lighter than the chassis. */
  dark: boolean;
  /** Scene background and the floor wash under the device. */
  bg: string;
  floor: string;
  floorEdge: string;
  /** The device itself: body, the inset plate the jacks are cut into, the top highlight. */
  chassis: string;
  bezel: string;
  chassisEdge: string;
  /** The redesigned firewall appliance: brighter machined steel for the rack ears / recess lip,
   *  dark recessed metal for vent panels + connector nubs, and a lit brand strip. `brand` is a cool
   *  blue (same family as deviceAccent) chosen so the appliance's glow is NEVER mistaken for the
   *  red/green STATUS glow — a firewall whose face glowed red would read as "down". */
  chassisTrim: string;
  chassisVent: string;
  brand: string;
  /** Group platforms: the labelled slab the tiles of one group stand on, and its rim. Sits one step
   *  between floor and tile in the bg<floor<slab<tile<chassis brightness ramp, so a slab reads as a
   *  shelf the tiles rest on, never competing with the tiles or the appliance. */
  plinth: string;
  plinthEdge: string;
  /** Pinned-device bodies: realistic, NEUTRAL materials, never health-tinted.
   *  steel = brushed-metal chassis, steelHi = its machined highlight, plastic = a
   *  light enclosure (AP / endpoint), trim = dark bezels / antennas / vents, accent =
   *  screens and link LEDs — a cool blue chosen so it never collides with the
   *  green/red STATUS glow, which stays the only thing that means "healthy / down". */
  deviceSteel: string;
  deviceSteelHi: string;
  devicePlastic: string;
  deviceTrim: string;
  deviceAccent: string;
  /** Tiles: an unlit card, its edge, and the text on and under it. */
  tile: string;
  tileEdge: string;
  ink: string;
  muted: string;
  /** Painted behind label glyphs so a cable passing under them cannot eat the text. */
  halo: string;
  /** Status — the ONLY things that glow. */
  up: string;
  down: string;
  unknown: string;
  /** Path meaning, shared with model.ts's edgeTone so 2D and 3D never disagree. */
  allow: string;
  warn: string;
  deny: string;
  /** Outside: the internet, WAN tags, the Outside lane's accent strip. */
  outside: string;
  /** Selection and focus only — never status, never a role. */
  select: string;
};

const SHARED = {
  up: "#22b783",
  allow: "#22b783",
  warn: "#ffb822",
  deny: "#f5325c",
  outside: "#16cdc7",
  select: "#6f6af8",
} as const;

export const PALETTE: Record<Mode, StagePalette> = {
  light: {
    ...SHARED,
    dark: false,
    bg: "#f6f7fb",
    floor: "#eceff6",
    floorEdge: "#f6f7fb",
    // Brushed steel, which is what a FortiGate actually looks like — the first two attempts (near
    // black navy, then slate indigo) both read as a dark brick on screen however the numbers
    // looked in a palette file. Only the BEZEL stays dark, because a lit jack needs something to
    // glow against; the body itself is the lightest part of the device.
    chassis: "#aeb8ca",
    bezel: "#424d68",
    chassisEdge: "#ccd4e2",
    // Redesigned firewall appliance + group platforms.
    chassisTrim: "#c7cedb",
    chassisVent: "#8a93a6",
    brand: "#2f80ed",
    plinth: "#e3e7f0",
    plinthEdge: "#d3d9e6",
    // Pinned-device bodies — neutral materials, never health-tinted (see the type doc above).
    deviceSteel: "#b4bccb",
    deviceSteelHi: "#d6dce6",
    devicePlastic: "#e8ebf1",
    deviceTrim: "#44506a",
    deviceAccent: "#2f80ed",
    tile: "#ffffff",
    tileEdge: "#d8dce7",
    ink: "#1d2433",
    muted: "#59627a",
    halo: "rgba(246,247,251,0.92)",
    down: "#9aa3b5",
    unknown: "#b9c0cf",
  },
  dark: {
    ...SHARED,
    dark: true,
    // Deliberately ordered bg < floor < tile < chassis. The first dark palette had the tiles only
    // a step off the background and they vanished into it; the device has to be the brightest
    // object in the room, with the tiles clearly readable but quieter than it.
    bg: "#0e121a",
    floor: "#1b2433",
    floorEdge: "#0e121a",
    chassis: "#8794b2",
    // The bezel goes the other way — a dark recess cut into a lighter body, so the lit jacks have
    // something to glow against.
    bezel: "#2c3650",
    chassisEdge: "#a8b4d0",
    // Redesigned firewall appliance + group platforms (brighter on the dark stage).
    chassisTrim: "#b6c2de",
    chassisVent: "#1f2838",
    brand: "#4f93ff",
    plinth: "#222c3e",
    plinthEdge: "#3a4760",
    // Pinned-device bodies — brighter neutrals than the light theme so a metal body still reads as
    // the brightest object on a dark stage; health stays only in the LED/glow.
    deviceSteel: "#9aa6c2",
    deviceSteelHi: "#c6cfe0",
    devicePlastic: "#cad1e0",
    deviceTrim: "#2f3950",
    deviceAccent: "#4f93ff",
    // Each step is deliberately wide. The first pass set these only a shade above the background
    // and the whole stage disappeared on a real monitor — readable on a bright laptop screen is not
    // the same as readable, and a dark theme has to survive the darker end of that range.
    tile: "#333f57",
    tileEdge: "#5e6d8c",
    ink: "#e6ebf4",
    muted: "#93a0b8",
    halo: "rgba(15,19,28,0.92)",
    down: "#5a6479",
    unknown: "#454f63",
  },
};

/** Lane accent strips. Outside is the only lane that earns a hue; the others stay quiet. */
export const laneAccent = (lane: "outside" | "inside" | "vpn", p: StagePalette): string =>
  lane === "outside" ? p.outside : p.muted;
