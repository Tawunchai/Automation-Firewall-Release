package policyobject

import (
	"fmt"

	"network_automation/services"
)

// The address objects a tunnel needs on each side.
//
// Split out of device_vpn.go. A tunnel names its local and remote subnets; FortiOS wants them as
// address objects, and past a handful of them as an address GROUP - which is what maxSubnetMembers
// and the migrate/sync pair below are for.

// ensureSubnetAddressSet makes `name` resolve to every subnet given, and is what lets the
// policies always reference ONE name ("<tunnel>_local") regardless of how many subnets there are:
//
//	one subnet  → a single firewall address called <name>
//	many        → addresses <name>_1…<name>_n plus an addrgrp called <name> holding them
//
// That is FortiGate's own wizard's shape — its Object Summary calls the result the "Local/Remote
// address group" either way, because the policy only ever points at <name>.
//
// An object that already exists (a re-run — the device answers -5) is reused rather than failing
// the batch: the end state is what we wanted.
func ensureSubnetAddressSet(fc deviceClient, name string, subnets []string) error {
	subs := cleanSubnets(subnets)
	if len(subs) == 0 {
		return nil
	}

	// A pre-existing set may be the legacy single-address shape. A name can be an address OR an
	// address group, never both (-163), so the current shape decides the path.
	if fc.AddressExists(name) && !fc.AddressGroupExists(name) {
		if len(subs) == 1 {
			// Stay in the legacy shape and just correct the subnet. This is the case the old code
			// got wrong: it re-issued a create, took the -5 as "already fine", and left the
			// original subnet in place while BGP moved on to the new one.
			return fc.UpdateAddress(name, services.FGAddress{
				Name: name, Type: "ipmask",
				Subnet: services.CIDRToFGSubnet(subs[0]), Comment: "IPsec " + name,
			})
		}
		if err := migrateAddressToGroup(fc, name); err != nil {
			return err
		}
	}
	return syncSubnetAddressGroup(fc, name, subs)
}

// syncSubnetAddressGroup makes the group `name` hold exactly one member per subnet.
func syncSubnetAddressGroup(fc deviceClient, name string, subs []string) error {
	comment := "IPsec " + name

	members := make([]string, 0, len(subs))
	for i, s := range subs {
		member := memberName(name, i+1)
		addr := services.FGAddress{
			Name: member, Type: "ipmask",
			Subnet: services.CIDRToFGSubnet(s), Comment: comment,
		}
		// Upsert: the member may be left over from a previous edit with a stale subnet.
		if fc.AddressExists(member) {
			if err := fc.UpdateAddress(member, addr); err != nil {
				return err
			}
		} else if err := fc.CreateAddress(addr); err != nil && !isDuplicateErr(err) {
			return err
		}
		members = append(members, member)
	}

	if fc.AddressGroupExists(name) {
		if err := fc.SetAddressGroupMembers(name, members, comment); err != nil {
			return err
		}
	} else if err := fc.CreateAddressGroupWithMembers(name, members, comment); err != nil && !isDuplicateErr(err) {
		return err
	}

	// Members the set has shrunk past. They are out of the group by now, so the delete is safe;
	// stop at the first gap. Without this a subnet removed in the GUI lingers as a stray object.
	for i := len(subs) + 1; i <= maxSubnetMembers; i++ {
		member := memberName(name, i)
		if !fc.AddressExists(member) {
			break
		}
		if err := fc.DeleteAddress(member); err != nil && !isGoneErr(err) {
			return fmt.Errorf("stale member %q not removed: %w", member, err)
		}
	}
	return nil
}

// migrateAddressToGroup converts a legacy single-address set into the group shape, keeping every
// policy that referenced it pointed at the set.
//
// The name itself has to be freed before a group can take it, and policies reference it live, so
// the order matters:
//
//  1. rename <name> → <name>_1   — FortiOS drags all references onto the new name, no gap
//  2. create group <name> holding <name>_1
//  3. repoint those references from <name>_1 back to <name>
//
// After step 3 the policies see the whole set again rather than only its first subnet.
func migrateAddressToGroup(fc deviceClient, name string) error {
	first := memberName(name, 1)
	if fc.AddressExists(first) {
		return fmt.Errorf("cannot convert address %q into a group: %q already exists", name, first)
	}
	if err := fc.RenameAddress(name, first); err != nil {
		return fmt.Errorf("cannot convert address %q into a group: %w", name, err)
	}
	if err := fc.CreateAddressGroupWithMembers(name, []string{first}, "IPsec "+name); err != nil && !isDuplicateErr(err) {
		// Put the name back so the policies are not left on a half-migrated set.
		_ = fc.RenameAddress(first, name)
		return fmt.Errorf("cannot create address group %q: %w", name, err)
	}
	return fc.RepointPolicyAddress(first, name)
}

// maxSubnetMembers bounds the stale-member sweep, mirroring the delete path's own ceiling.
const maxSubnetMembers = 32

func memberName(set string, i int) string { return fmt.Sprintf("%s_%d", set, i) }
