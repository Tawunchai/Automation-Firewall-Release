package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Undoing a change that was made OUTSIDE the console — the one case where that is safe object by
// object: an object someone created on the firewall directly. See OutsideUndoPlan for why the other
// cases are restore-only.
//
// The undo is a write to a live firewall like any other, so it goes in the Change Ledger with the
// object's full state as `before`. That makes the undo itself undoable from the timeline (a ledger
// delete with a snapshot re-creates the object), and it means the next backup comparison attributes
// the deletion to whoever pressed the button instead of reporting it as fresh drift.

// ErrOutsideObjectGone is returned when the object is no longer on the device — somebody already
// removed it. The end state the undo wanted already holds.
var ErrOutsideObjectGone = errors.New("the object is no longer on the firewall")

// GetCMDBObject reads one object by key from a CMDB collection path ("/api/v2/cmdb/firewall/address").
// Returns the object as the device sent it.
func (f *FortiClient) GetCMDBObject(collection, key string) (json.RawMessage, error) {
	collection = strings.TrimRight(strings.TrimSpace(collection), "/")
	key = strings.TrimSpace(key)
	if collection == "" || key == "" {
		return nil, fmt.Errorf("a collection and a key are both required")
	}
	resp, err := f.do("GET", collection+"/"+url.PathEscape(key), nil)
	if err != nil {
		return nil, err
	}
	var list []json.RawMessage
	if json.Unmarshal(resp.Results, &list) == nil {
		if len(list) == 0 {
			return nil, ErrOutsideObjectGone
		}
		return list[0], nil
	}
	// Some tables answer a by-key read with the object itself rather than a one-element list.
	if len(resp.Results) > 0 && string(resp.Results) != "null" {
		return resp.Results, nil
	}
	return nil, ErrOutsideObjectGone
}
