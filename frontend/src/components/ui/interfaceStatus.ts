import type { SystemInterface } from "../../api/policyObject";

// Shared by DeviceFaceplate (the port board) and the Interfaces table, so both read the SAME
// verdict for a port. They used to disagree: the table counted a `link_up === null` interface
// (link state FortiOS did not report — true of every non-physical interface, since a VLAN switch
// or aggregate has no transceiver of its own to read) as "up", while the faceplate drew the
// identical port grey, "down". A page whose whole job is "which ports are up" cannot tell two
// different answers for the same port depending which widget you look at.
//
// Lives in its own module rather than inside DeviceFaceplate.tsx: a file that exports both a
// component and a plain function breaks React Fast Refresh for that component
// (react-refresh/only-export-components).

export type PortState = "up" | "down" | "disabled";

/** Administrative shutdown wins over link state — a shut port has no meaningful link. */
export const portState = (i: SystemInterface): PortState =>
  i.status === "down" ? "disabled" : i.link_up === true ? "up" : "down";

/**
 * The same verdict, but keeping "not reported" apart from "down".
 *
 * `portState` folds `link_up === null` into "down", which is the right call for a board whose
 * question is "is this jack carrying a link": an unknown link is not a working one. The 3D stage
 * asks a second question the board does not — "do we actually KNOW?" — because the backend's
 * `interfaceLinkState()` returns an EMPTY map when `monitor/system/interface` fails, which lands
 * here as every port reporting null at once and no error anywhere. Drawn as "down" that is a
 * firewall with every cable pulled out; drawn as "unknown" it is the truth. See the stage model
 * for how an all-null read is promoted to a section-level "could not be read".
 */
export const linkState = (i: SystemInterface): "up" | "down" | "admin-down" | "unknown" =>
  i.status === "down" ? "admin-down"
    : i.link_up === true ? "up"
    : i.link_up === false ? "down"
    : "unknown";
