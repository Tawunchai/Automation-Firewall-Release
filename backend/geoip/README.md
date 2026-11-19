# GeoLite2 databases (Trace Route hop geolocation)

This directory holds the **MaxMind GeoLite2** databases that power the geolocation + ASN half of the
Trace Route hop detail (`/admin/diagnostics/traceroute` → click a hop → "where?").

It is **optional**. With no databases here the feature still works — each hop shows reverse DNS, its
address kind (public / private / CGNAT / …) and any role it plays on this console's own networks.
The databases only add country / city / ASN / ISP for **public** hops, entirely **offline** (the
`.mmdb` files are memory-mapped; no third-party API is ever called).

## Files expected here

- `GeoLite2-City.mmdb`  — country + city + coordinates
- `GeoLite2-ASN.mmdb`   — autonomous system number + organisation (the ISP)

Both are **git-ignored** (`.gitignore` → `backend/geoip/*.mmdb`): they are ~60–70 MB and are
licensed per the MaxMind GeoLite2 EULA, so they must not enter the repository (the same reason the
old bundled fonts were removed).

## Getting them

GeoLite2 is free but needs a MaxMind account and a **license key**:

1. Create a free account at <https://www.maxmind.com/en/geolite2/signup>
2. Generate a license key (Account → Manage License Keys)
3. From the repo root:

   ```bash
   MAXMIND_LICENSE_KEY=<your-key> ./scripts/download-geoip.sh
   ```

   The script downloads both databases and extracts the `.mmdb` files into this directory.

4. Restart the backend so it picks them up:

   ```bash
   docker compose up -d --build backend
   ```

The backend reads the paths from `GEOIP_CITY_DB` / `GEOIP_ASN_DB` (set in `docker-compose.yml` to
`/geoip/GeoLite2-City.mmdb` and `/geoip/GeoLite2-ASN.mmdb`, this directory mounted read-only).

To keep the data current, MaxMind updates GeoLite2 twice a week — re-run the script on a schedule.
