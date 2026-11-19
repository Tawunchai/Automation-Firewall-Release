import type { IPPool, IPPoolType } from "../../api/objectGroups";

// The arithmetic behind an IP pool, kept out of the component so it can be tested without a DOM.
//
// A NAT pool is four numbers, and their relationship — not their individual values — decides
// whether traffic survives. FortiOS accepts every combination of them with a 200 and says nothing,
// so the cases below are silent failures on a live firewall:
//
//   fixed-port-range with more internal addresses than external ones
//       This type PRESERVES the source port, so each internal host needs its own external address.
//       The hosts past the end of the external range are simply not translated. No log, no error.
//
//   port-block-allocation asking for more ports than an address has
//       block size × blocks per user > 64,512 (ports 1024-65535) means exactly one user fits
//       on each address, which is never what was intended.
//
//   overload with a one-address range
//       Legal and common — this is plain PAT. Worth SAYING, because an operator who picked
//       "Overload" thinking they were getting a range of addresses has misread the type.
//
// The server validates the same rules (controller/policyobject/device_ippool.go). This copy is not
// redundant: it turns them into a sentence while the operator is typing, which is when the
// information is useful.

export type PoolDraft = {
  name: string;
  type: IPPoolType;
  startIp: string;
  endIp: string;
  sourceStartIp: string;
  sourceEndIp: string;
  blockSize: number;
  numBlocksPerUser: number;
  arpReply: boolean;
  arpInterface: string;
  associatedInterface: string;
  permitAnyHost: boolean;
  comments: string;
};

/** Usable ports on one IPv4 address, 1024-65535. */
const USABLE_PORTS = 64512;

const OCTET = /^\d{1,3}$/;

/** Parses an IPv4 string to a number, or null when it is not one. */
export const ipToNumber = (s: string): number | null => {
  const parts = s.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!OCTET.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
};

/** Addresses in an inclusive range, or 0 when either end is unparseable or the order is wrong. */
export const rangeCount = (start: string, end: string): number => {
  const a = ipToNumber(start);
  const b = ipToNumber(end);
  if (a === null || b === null || b < a) return 0;
  return b - a + 1;
};

export type PoolSizes = {
  externalCount: number;
  internalCount: number;
  /** One sentence describing what this pool will do. */
  summary: string;
  /** Set when the numbers describe something that silently does not work. */
  warning: string | null;
};

/** What the draft's numbers mean, as a sentence, while it is being typed. */
export const poolSizes = (d: PoolDraft): PoolSizes => {
  const externalCount = rangeCount(d.startIp, d.endIp);
  const internalCount = rangeCount(d.sourceStartIp, d.sourceEndIp);

  if (externalCount === 0) {
    return {
      externalCount, internalCount,
      summary: "Enter an external IP range to see what this pool will do.",
      warning: null,
    };
  }

  const plural = (n: number) => `${n.toLocaleString()} address${n === 1 ? "" : "es"}`;

  switch (d.type) {
    case "fixed-port-range": {
      if (internalCount === 0) {
        return {
          externalCount, internalCount,
          summary: `${plural(externalCount)} external. Add the internal range this maps from.`,
          warning: null,
        };
      }
      if (internalCount > externalCount) {
        return {
          externalCount, internalCount,
          summary: "",
          warning: `Fixed Port Range keeps the source port, so each internal address needs its own external one. There are ${plural(internalCount)} internal and only ${plural(externalCount)} external — the last ${(internalCount - externalCount).toLocaleString()} would not be translated at all, and the device will not warn you.`,
        };
      }
      return {
        externalCount, internalCount,
        summary: `${plural(internalCount)} internal mapped one-for-one onto ${plural(externalCount)} external, source port preserved.`,
        warning: null,
      };
    }

    case "port-block-allocation": {
      const perUser = d.blockSize * d.numBlocksPerUser;
      if (d.blockSize <= 0 || d.numBlocksPerUser <= 0) {
        return {
          externalCount, internalCount,
          summary: `${plural(externalCount)} external. Set a block size and blocks per user.`,
          warning: null,
        };
      }
      if (perUser > USABLE_PORTS) {
        return {
          externalCount, internalCount,
          summary: "",
          warning: `${d.blockSize} ports × ${d.numBlocksPerUser} blocks is ${perUser.toLocaleString()} ports per user, more than the ${USABLE_PORTS.toLocaleString()} usable on one address.`,
        };
      }
      const usersPerAddress = Math.floor(USABLE_PORTS / perUser);
      return {
        externalCount, internalCount,
        summary: `${perUser.toLocaleString()} ports per user — about ${(usersPerAddress * externalCount).toLocaleString()} concurrent users across ${plural(externalCount)}. Each user's blocks are logged, so a session can be traced back.`,
        warning: null,
      };
    }

    case "one-to-one":
      return {
        externalCount, internalCount,
        summary: `${plural(externalCount)}, one internal host each, no port translation — so ${externalCount} hosts can be translated at a time.`,
        warning: null,
      };

    default: // overload
      return {
        externalCount, internalCount,
        summary: externalCount === 1
          ? "One external address shared by everything, ports rewritten. This is plain PAT — pick One-to-One or Fixed Port Range if you meant each host to get its own address."
          : `${plural(externalCount)} shared, ports rewritten across all of them.`,
        warning: null,
      };
  }
};

/** Per-row summary for the list: the address count and any warning worth a marker. */
export const describePool = (p: IPPool): { externalCount: number; warning: string | null } => {
  const externalCount = rangeCount(p.start_ip, p.end_ip);
  if (p.type === "fixed-port-range") {
    const internal = rangeCount(p.source_start_ip ?? "", p.source_end_ip ?? "");
    if (internal > externalCount) {
      return {
        externalCount,
        warning: `${internal} internal addresses onto ${externalCount} external — the last ${internal - externalCount} are not translated`,
      };
    }
  }
  if (p.type === "port-block-allocation") {
    const perUser = (p.block_size ?? 0) * (p.num_blocks_per_user ?? 0);
    if (perUser > USABLE_PORTS) {
      return { externalCount, warning: `${perUser} ports per user exceeds the ${USABLE_PORTS} on one address` };
    }
  }
  return { externalCount, warning: null };
};

/** Form-level validation. Returns the problem, or null when the draft may be sent. */
export const validateDraft = (d: PoolDraft): string | null => {
  if (!d.name.trim()) return "Name is required";
  if (d.name.trim().length > 79) return "Name is too long — FortiOS allows 79 characters";
  if (ipToNumber(d.startIp) === null || ipToNumber(d.endIp) === null) {
    return "External IP range needs two IPv4 addresses";
  }
  if (rangeCount(d.startIp, d.endIp) === 0) return "The external range ends before it starts";

  if (d.type === "fixed-port-range") {
    if (ipToNumber(d.sourceStartIp) === null || ipToNumber(d.sourceEndIp) === null) {
      return "Fixed Port Range needs an internal IP range as well as an external one";
    }
    if (rangeCount(d.sourceStartIp, d.sourceEndIp) === 0) {
      return "The internal range ends before it starts";
    }
  }
  if (d.type === "port-block-allocation") {
    if (d.blockSize <= 0) return "Block size is required";
    if (d.numBlocksPerUser <= 0) return "Blocks per user is required";
  }

  // The silent-failure cases become blocking errors rather than advice: the operator is about to
  // write a pool that the device will accept and that will not work.
  const sizes = poolSizes(d);
  return sizes.warning;
};
