# backend — Go (Gin + GORM), module `network_automation`

The console's API. It talks to **FortiGate/FortiOS over HTTPS REST and SSH**, to Postgres, and to
Redis (the queue the Python worker reads). Entry point is `main.go`, port **9000**.

> This file is a map of the folders. For how the whole product fits together, and for the rules
> that apply when changing it, read [HANDOVER.md](../HANDOVER.md) first — §3 for the layers,
> §6 for the six layers a feature has to touch, §8 for the traps.

## Where things are

| folder | what lives there |
|---|---|
| `main.go` | entry point: config, migrations, routes, graceful shutdown |
| `config/` | one file, `db.go` — connect, AutoMigrate, and **SeedDatabase**: what a brand-new install is born with (the admin account, roles, the password policy, the device-access migration) |
| `entity/` | GORM models, one file per table |
| `routes/` | `routes.go` plus five registrars that split the route table by area (`routes_app`, `routes_device_objects`, `routes_device_system`, `routes_automation`, `routes_analytics`) |
| `controller/<domain>/` | HTTP handlers, one package per domain. The big one is `policyobject/` — every `device_*.go` there is a FortiGate-facing handler |
| `services/` | everything that is not HTTP. `fortigate_*.go` is the device client and its per-domain payload builders; `ai_*.go` is the assistant; `audit_*.go` is the compliance engine |
| `services/platform/` | crypto at rest, mail, OTP gating, text helpers — the parts with no FortiGate knowledge |
| `services/prompts/` | the AI system prompt's reference text. **`go:embed`s from `services/`, so the path is fixed** |
| `services/gen/` | `extract_oscal.py`, which generates `services/nist_sp800_53.json`. A test keeps the two in step |
| `middleware/` | auth, rate limiting, the change recorder. ⚠️ **the folder is `middleware` but the package is `middlewares`**, so every import needs the alias `middlewares "network_automation/middleware"` |
| `scheduler/` | the 60-second loop: scheduled backups, the alert sweep, metric samples, retention |
| `jobs/` | enqueueing automation jobs. A package of its own **only to break an import cycle** — `services` cannot import `config` |
| `geoip/` | README only. The GeoLite2 `.mmdb` files are downloaded by `scripts/download-geoip.sh` and git-ignored |
| `test/` | **not** the test suite — see below |

## Why `_test.go` files are not all in `test/`

Because Go does not allow it. A test in another folder is a different package and can only reach
**exported** identifiers. Of the 274 test files outside `test/`, every one declares its own
package (`package services`, not `package services_test`) and **86% reference something unexported
in it**. Move one and it stops compiling:

```
vet: test/moved_test.go:107:2: undefined: fortiSessions
```

Co-located tests are also what makes the **coverage ratchet** work: coverage is attributed per
package, so a test in `test/` would count towards `test` and leave the package it exercises at 0%.

`backend/test/` is `package unit` — black-box, exported API only — and holds two things:

- **the repo-shape ratchets**: `layout_budget_test.go` (file size, by lines and by bytes) and
  `coverage_budget_test.go`, with their three `.json` budgets. These test the *repository*, not the
  code.
- **seven suites that predate the FortiGate work** (`jwt`, `otp`, `role`, `user`, `calendar`,
  `password_policy`, `send_email`). They pass through exported API, so they are legal where they
  are, and moving them was considered and declined.

## Tests that need a database

Many suites skip unless a DSN is set, one environment variable per package
(`SEED_DB_TEST_DSN`, `POLICYOBJECT_DB_TEST_DSN`, …). The full list is in the `coverage` job of
`.github/workflows/ci.yml`, which is also the only place they all run at once.

**Point them at a throwaway container, never at the console's own database — they DROP tables.**

```bash
docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name pg-test postgres:16-alpine
SEED_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
  go test ./config/ -v
```

To reproduce the coverage job itself — which a Windows machine cannot do faithfully, because the
numbers differ from CI's Linux and pinned Go — run it in containers; the recipe is in the project
memory under *Pre-handover cleanup*.

## Gates this folder must pass

```bash
go build ./...
go vet ./...
gofmt -l .        # must print nothing
go test ./...     # includes BOTH layout budgets and the handler-coverage check
```

`staticcheck` is a hard 0-finding gate but runs only in CI. `go test -race` likewise: this
repository is developed on Windows, which has no cgo here, so the race detector only ever runs in
the `race` job.
