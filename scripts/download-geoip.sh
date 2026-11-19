#!/usr/bin/env bash
#
# Download the MaxMind GeoLite2 City + ASN databases used by the Trace Route hop geolocation
# feature (/admin/diagnostics/traceroute → click a hop → "where?").
#
# GeoLite2 is free but needs a MaxMind account + license key:
#   https://www.maxmind.com/en/geolite2/signup   (Account → Manage License Keys)
#
# Usage, from the repo root:
#   MAXMIND_LICENSE_KEY=<your-key> ./scripts/download-geoip.sh
#
# The .mmdb files land in backend/geoip/ (git-ignored). Restart the backend afterwards:
#   docker compose up -d --build backend
#
set -euo pipefail

: "${MAXMIND_LICENSE_KEY:?set MAXMIND_LICENSE_KEY — get a free key at https://www.maxmind.com/en/geolite2/signup}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$SCRIPT_DIR/../backend/geoip"
mkdir -p "$DEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  local edition="$1" out="$2"
  echo "→ downloading $edition"
  local url="https://download.maxmind.com/app/geoip_download?edition_id=${edition}&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz"
  if ! curl -fsSL "$url" -o "$TMP/${edition}.tar.gz"; then
    echo "  ! download failed — check the license key and that the edition is enabled on your account" >&2
    exit 1
  fi
  tar -xzf "$TMP/${edition}.tar.gz" -C "$TMP"
  local mmdb
  mmdb="$(find "$TMP" -name "${edition}.mmdb" | head -n1)"
  [ -n "$mmdb" ] || { echo "  ! ${edition}.mmdb not found in the archive" >&2; exit 1; }
  mv -f "$mmdb" "$DEST/$out"
  echo "  ✓ $DEST/$out"
}

fetch GeoLite2-City GeoLite2-City.mmdb
fetch GeoLite2-ASN  GeoLite2-ASN.mmdb

echo
echo "Done. Now restart the backend so it loads them:"
echo "  docker compose up -d --build backend"
