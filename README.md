# FortiGate Network Automation Console

เว็บคอนโซลสำหรับจัดการ **ไฟร์วอลล์ Fortinet FortiGate (FortiOS)** — ทำงานแทน GUI ของตัวอุปกรณ์ได้
และเพิ่มสิ่งที่ GUI ทำไม่ได้: ประวัติการเปลี่ยนแปลงว่าใครแก้อะไร, ตรวจจับ config ที่ถูกแก้นอกคอนโซล,
ตรวจ compliance ตามมาตรฐาน (PCI / ISO / NIST), คิวอนุมัติก่อนเขียนอุปกรณ์, แจ้งเตือน, และผู้ช่วย AI
ที่เขียน FortiOS CLI ให้จากภาษาคน

> 🧭 **มารับงานต่อ / เพิ่งเปิด repo นี้ครั้งแรก → อ่าน [HANDOVER.md](HANDOVER.md)**
> เอกสารส่งมอบฉบับเต็ม: สถาปัตยกรรม, ติดตั้งจากศูนย์, วิธีแก้โค้ด, กับดักที่ต้องรู้,
> ผลตรวจความปลอดภัย, หนี้ทางเทคนิคที่เหลือไว้ และสิ่งที่ห้ามทำ
>
> ไฟล์นี้คือภาพรวมสั้น ๆ + วิธีรันให้ขึ้นเร็วที่สุด

**vendor เดียวคือ Fortinet** — ทดสอบกับ FortiGate-80E / FortiOS 7.2.10 ไม่มี Cisco / Juniper / Palo Alto
และไม่ควรเพิ่มเข้ามาโดยไม่ตั้งใจ

---

## 1. สถาปัตยกรรมย่อ

สามชั้น สามภาษา ตัวกลางคือ Postgres กับ Redis

```
  เบราว์เซอร์
      │
      ▼
┌─────────────────────┐   axios → /api
│ React 19 + Vite     │   (dev: vite proxy · prod: nginx reverse proxy)
│ :5173 / :5443 HTTPS │
└──────────┬──────────┘
           ▼
┌─────────────────────┐   ┌──► FortiGate REST  /api/v2/cmdb     อ่าน/เขียน config จริง
│ Go 1.26 (Gin+GORM)  ├───┼──► FortiGate REST  /api/v2/monitor  CPU / session / license / VPN
│ :9000               │   ├──► SSH            uptime, ping, traceroute, terminal
└──┬───────────────┬──┘   └──► Anthropic Claude                 ผู้ช่วย AI + คำแนะนำ remediation
   │               │
   ▼               ▼
Postgres 16     Redis 7 ──► Python 3.14 worker (netmiko)
(สถานะแอป)      (คิวงาน)     backup → git · config push · compliance check
```

- **ไม่มีอะไรวิ่งเข้าอุปกรณ์โดยตรงจากเบราว์เซอร์** ทุกอย่างผ่าน Go backend ที่เดียว
- การเขียนอุปกรณ์ที่สำคัญ (firewall policy / VIP / security profile) ถูก **ดักเข้าคิวอนุมัติ** ก่อน
- ทุกการเขียนที่สำเร็จถูกบันทึกลง **Change Ledger** พร้อมชื่อคนที่กด

รายละเอียดว่าโค้ดชิ้นไหนอยู่ไฟล์ไหน → [HANDOVER.md §3](HANDOVER.md#3-สถาปัตยกรรม-ชั้นต่อชั้น)

---

## 2. รันให้ขึ้นใน 3 คำสั่ง

ต้องมี **Docker Desktop** (หรือ Docker Engine + compose v2) อย่างเดียว

```bash
git clone <repo-url> Network-Automation && cd Network-Automation

./scripts/bootstrap.sh                 # Windows: powershell -File scripts\bootstrap.ps1
docker compose up -d --build

docker compose ps                      # ต้อง healthy ทั้ง 5 service
docker compose logs backend | grep -i -A3 "SEEDED LOGIN"   # รหัส admin ที่ seed มา (พิมพ์ครั้งเดียว)
```

เปิด **<http://localhost:5173>** → ล็อกอินด้วย `admin@got.co.th` + รหัสจาก log ด้านบน

> ⛔ **อย่า `cp .env.example .env`** — มันบูตไม่ขึ้น และนั่นคือเจตนา
> ค่าลับ 5 ตัวในไฟล์ตัวอย่างเว้นว่างไว้ (template ที่มี secret จริง = วันหนึ่งจะถูก commit) และ 4 ตัว
> เป็น `${VAR:?}` guard ใน `docker-compose.yml` → compose ปฏิเสธก่อนสร้าง container เลย
> `scripts/bootstrap.sh` generate ให้ทั้ง 5 ตัว (hex 32 ไบต์) แล้วแทน `POSTGRES_PASSWORD` ลงใน
> `DATABASE_URL` ให้ด้วย

> ⛔ **`docker compose down -v` ลบ database ทิ้งทั้งหมด** รวม device credential ที่เข้ารหัสไว้
> ปิด stack ด้วย `docker compose stop` หรือ `docker compose down` เฉย ๆ

สิ่งที่ยังว่างหลัง bootstrap และ **ไม่ขัดการบูต** — ขาดแล้วเพียงปิดฟีเจอร์นั้น:

| ตัวแปรใน `.env` | ขาดแล้วเป็นอะไร |
|---|---|
| `ANTHROPIC_API_KEY` | หน้า Wizard Config ตอบ "not configured" · AI wizard ทุกตัวใช้ไม่ได้ |
| `GOOGLE_` / `GITHUB_` / `LINE_` `CLIENT_ID`+`SECRET` | ซ่อนปุ่ม sign-in นั้น (email+password ยังใช้ได้ปกติ) |
| `SEED_SMTP_EMAIL` + `SEED_SMTP_APP_PASSWORD` | ไม่ส่ง OTP ทางเมล · ไม่ส่งรายงาน (ตั้งทีหลังได้ที่หน้า Services) |
| `MAXMIND_LICENSE_KEY` → `scripts/download-geoip.sh` | Trace Route ไม่บอกประเทศ/ASN ของ hop สาธารณะ |

ขั้นตอนติดตั้งแบบละเอียด รวม HTTPS สำหรับใช้ในวง LAN และวิธี deploy →
[HANDOVER.md §4](HANDOVER.md#4-ติดตั้งจากศูนย์) และ [§5](HANDOVER.md#5-เปิด-https-สำหรับใช้ในวง-lan)

---

## 3. แผนที่ฟีเจอร์

ที่มาเดียวที่เชื่อถือได้มีสองไฟล์ — **อย่าเชื่อเอกสาร เชื่อสองไฟล์นี้**

- `backend/routes/routes.go` (+ `routes_*.go` อีก 5 ไฟล์) — endpoint ทั้งหมด **351 เส้น**
  ซึ่ง **198 เส้น** อยู่ใต้ `/policy/device/:deviceId/...` คือ proxy ตรงเข้าอุปกรณ์
- `frontend/src/components/structure/sidebar/data.tsx` — เมนู **47 หน้า**

`*` = เห็นและเรียกได้เฉพาะ **admin** (ซ่อนเมนู *และ* กันที่ endpoint — เมนูที่กดแล้ว 403 แย่กว่าไม่มีเมนู)

| Section | หน้า | ธุระของหมวดนี้ |
|---|---|---|
| **Dashboard** | Dashboard | สถานะเครื่องสด ๆ (monitor API + SSH สำหรับ uptime) |
| **Automation** | Devices · Multi Config · Wizard Config · Change Requests | เปลี่ยนของ / สั่งงาน / คิวอนุมัติ |
| **Diagnostics** | Troubleshooting · Trace Route* | ถามอุปกรณ์เดี๋ยวนี้ |
| **Analytics** | Config Drift (+ แท็บ Change Ledger) · Rule Lifecycle · Audit / Review* | มองย้อนหลัง — ไม่เขียนอุปกรณ์ |
| **Log & Report** | Local Traffic* · Log Settings | แสดงบันทึก / ตั้งว่าจะบันทึกอะไร |
| **Network** | Topology (2D/3D) · Interfaces (read-only) · Static Routes · DHCP Servers · SD-WAN | |
| **Policy & Objects** | Firewall Policy · Addresses · Services · Schedules · Virtual IPs · IP Pools · Traffic Shaping | (Address/Service **Groups** เป็นหน้าลูกของ Addresses/Services) |
| **VPN** | IPsec Tunnels · IPsec Wizard · IPsec Tunnel Template | |
| **System** | HA Status (read-only) · SNMP* · Administrators* | ตัวเครื่องเอง ไม่ใช่ทราฟฟิกที่วิ่งผ่าน |
| **Security Profiles*** | Intrusion Prevention · AntiVirus · Web Filter · DNS Filter · Application Control · File Filter · SSL/SSH Inspection · Web Rating Overrides | |
| **User & Authentication*** | User Definition · User Groups · LDAP Servers · RADIUS Servers | ผู้ใช้บน **ไฟร์วอลล์** |
| **Apps** | Notify* · Calendar | |
| **Security*** | Users · Services · Password Policy | ผู้ใช้ของ **คอนโซลเอง** — ไม่แตะอุปกรณ์ |
| เมนูชื่อผู้ใช้ | My Profile (มีแท็บ **Device Credentials**) · Password | ทุก role |

ชื่อเมนูบางอันไม่ตรงกับ route เพราะเคยเปลี่ยนชื่อ แต่ route เดิมไม่พัง:

| เมนู | route |
|---|---|
| Multi Config | `/admin/config-deploy` |
| Wizard Config | `/admin/ai-assistant` |
| Change Ledger (เก่า) | redirect → `/admin/config-drift?show=console` |
| Ping (เก่า) | redirect → `/admin/diagnostics/troubleshooting?tab=ping` |
| Session Monitor (เก่า) | redirect → `/admin/diagnostics/troubleshooting` |

สิ่งที่คอนโซลทำได้ซึ่ง GUI ของ FortiGate ทำไม่ได้ — อธิบายไว้ที่
[HANDOVER.md §2](HANDOVER.md#2-ระบบนี้ทำอะไรได้)

---

## 4. โครงสร้างโปรเจกต์

```
.
├── HANDOVER.md               ← เอกสารส่งมอบ (อ่านก่อนแก้โค้ด)
├── CONTRIBUTING.md           กฎย่อ 8 ข้อที่ห้ามลืมก่อนแก้โค้ด
├── .env.example              ต้นแบบของ .env (bootstrap.sh อ่านไฟล์นี้)
├── docker-compose.yml        5 service: postgres · redis · backend · worker · frontend
│
├── backend/                  Go 1.26 (Gin + GORM) — module `network_automation`, :9000
│   ├── main.go               config → AutoMigrate → seed → routes → graceful shutdown
│   ├── config/db.go          connect + AutoMigrate + SeedDatabase (สิ่งที่ install ใหม่เกิดมาพร้อม)
│   ├── entity/               GORM model หนึ่งไฟล์ต่อหนึ่งตาราง
│   ├── routes/               routes.go + registrar 5 ไฟล์แบ่งตามพื้นที่
│   ├── controller/<domain>/  HTTP handler — ตัวใหญ่คือ `policyobject/` (ทุก device_*.go คุยกับไฟร์วอลล์)
│   ├── services/             ทุกอย่างที่ไม่ใช่ HTTP — fortigate_*.go (client), ai_*.go, audit_*.go, drift
│   │   ├── platform/         crypto-at-rest, mail, OTP gate — ส่วนที่ไม่รู้จัก FortiGate
│   │   └── prompts/          ข้อความอ้างอิงของ AI (go:embed จาก services/)
│   ├── middleware/           auth, rate limit, approval gate, change recorder
│   │                         ⚠️ โฟลเดอร์ชื่อ `middleware` แต่ package ชื่อ `middlewares`
│   ├── scheduler/            ลูป 60 วินาที: backup ตามเวลา, alert sweep, metric sample, retention
│   ├── jobs/                 enqueue งานเข้า Redis (แยก package เพื่อตัด import cycle)
│   └── test/                 **ไม่ใช่ชุดเทสต์หลัก** — ratchet ของ repo + 7 suite เก่า (ดู backend/README.md)
│
├── frontend/                 React 19 + TypeScript + Tailwind v4 + Vite, :5173
│   └── src/
│       ├── api/              ชั้น axios แยกตาม domain (52 ไฟล์) — `http.ts` คือ instance กลาง
│       ├── pages/            1 โฟลเดอร์ = 1 หน้าใน sidebar (37 โฟลเดอร์)
│       ├── components/ui/    ชุด UI เขียนเอง — **ไม่มี Ant Design**
│       ├── components/structure/  MainLayout · navbar · sidebar (`data.tsx` = แผนที่ฟีเจอร์)
│       ├── contexts/         Auth · Device (ตัวเลือกอุปกรณ์อันเดียวทั้งแอป) · Provider (ธีม) · AiJob
│       ├── hooks/            `useDeviceData` (strict read) · `useFetch`
│       ├── i18n/             EN / TH / ZH แปลตอน render — ไม่มี `t()` ในหน้า
│       └── e2e/              playwright smoke (ต้องมี FortiGate จริง — ไม่อยู่ใน CI)
│
├── worker/                   Python 3.14 + netmiko — BRPOP คิวจาก Redis
│   └── worker.py             → backup_fortigate.py (netmiko → git) · config_push.py · compliance
│
└── scripts/                  bootstrap · gen-lan-cert · rotate-cred-key · download-geoip
```

---

## 5. พัฒนาต่อ

### รันแบบ local (แก้ frontend ให้เร็ว)

ต้องมี Go 1.26+ · Node 24+ · Postgres 16 (หรือใช้ตัวที่มาจาก compose)

```bash
cd backend  && go mod download && go run .     # :9000 — อ่าน ../.env ไฟล์เดียวกับ compose
cd frontend && npm install && npm run dev      # :5173, proxy /api → :9000
```

`go run .` ก็ยังต้องมี `.env` ที่ bootstrap สร้าง — `ValidateCredKeyConfig()` และ
`ValidateWorkerSecret()` ตรวจตอนบูตเหมือนกัน

หลังแก้ Go แล้วใช้ stack ของ docker:

```bash
docker compose up -d --build backend
```

### Quality gate — ต้องเขียวทั้งหมดก่อน commit

```bash
cd backend  && go build ./... && go vet ./... && gofmt -l . && go test ./...
cd frontend && npm run test && npm run build && npm run lint:budget
cd worker   && python -m unittest discover -p 'test_*.py'
```

- `npm run test` เท่านั้น **อย่าใช้ `npx vitest`** — drive letter ตัวพิมพ์เล็กทำให้โหลด runner ซ้อนสองตัว
  แล้วรายงานว่า "no tests" ทุกไฟล์
- `gofmt -l .` ต้องไม่พิมพ์อะไรออกมา
- `staticcheck` และ `go test -race` รันบน Windows ไม่ได้ ต้องผ่าน container หรือ CI
- budget ทั้ง 3 ตัวเป็น **ratchet สองทาง** — ขึ้นก็ fail ลงก็ fail (ต้อง lock ค่าใหม่)
- แก้/เพิ่มข้อความบนหน้าจอ → ต้อง `node scripts/i18n-extract.mjs` แล้ว commit `scripts/i18n-strings.json`

ครบทุกข้อพร้อมเหตุผล → [HANDOVER.md §7](HANDOVER.md#7-quality-gate-ทุกตัว-และวิธีรัน)
หรือรัน slash command `/fg-preflight` ซึ่งรันทั้งหมดตามลำดับและพิมพ์ตัวเลขสดออกมา

### ก่อนแตะโค้ดที่คุยกับอุปกรณ์ — 3 ข้อที่ต้องรู้

1. **ห้าม `DELETE` ที่ CMDB collection URL** — ตอบ 200 แล้วลบทั้งตาราง กู้ไม่ได้ ลบต้องระบุ mkey เสมอ
2. **อย่าเดา FortiOS schema** — ยืนยันจาก `?action=schema` แล้ว **เขียนจริง 1 ครั้ง อ่านกลับมาเทียบ**
   (schema บอกแค่ว่าชื่อสะกดยังไง ไม่ได้บอกว่าเฟิร์มแวร์นี้รองรับ)
3. **รหัส error ของ FortiOS เป็นตัวเลข** — `strings.Contains(err, "-5")` จับ `-50..-59`, `-518`
   และ object ชื่อ `site-5` ไปด้วย ใช้ `errors.As` กับ `DeviceError{Code}`

ทั้งหมด → [HANDOVER.md §8](HANDOVER.md#8-กับดักที่ต้องรู้ก่อนแตะโค้ด)

### เอกสารเชิงลึก

| ไฟล์ | เปิดเมื่อ |
|---|---|
| [HANDOVER.md](HANDOVER.md) | **รับงานต่อ** — ติดตั้ง, พัฒนา, deploy, ความปลอดภัย, หนี้ที่เหลือ |
| [backend/README.md](backend/README.md) | หาว่าโฟลเดอร์ไหนทำอะไร · เทสต์ที่ต้องมี database |
| [CONTRIBUTING.md](CONTRIBUTING.md) | กฎย่อ 8 ข้อที่ห้ามลืม (ย่อจาก HANDOVER §6 และ §8) |

---

## 6. ข้อควรรู้เร่งด่วน 4 ข้อ

1. **ระบบนี้ควบคุมไฟร์วอลล์จริง** ไม่ใช่ mock — เครื่องแล็บคือ FortiGate-80E ที่ `10.10.20.90` (device id 1)
   คำสั่งที่ยิงผิดมีผลกับทราฟฟิกจริง
2. **`.env` ต้องไม่ถูก commit ไม่ว่ากรณีใด** — มันถือ `CRED_ENC_KEY` ที่ถอดรหัสผ่านไฟร์วอลล์
   ทุกตัวได้ · history ของ repo นี้สะอาด และมี gitleaks + CI job กันไว้
   ([รายละเอียด](HANDOVER.md#11-secret-กับการเปิด-repository-เป็น-public))
3. **CI บน GitHub แดงอยู่เพราะเรื่องบิล ไม่ใช่โค้ดพัง** — job ทั้ง 9 ตัวตายที่ 2 วินาทีเท่ากันหมด
   เพราะ GitHub ไม่ยอมจ่าย runner ให้ ([อ่านก่อนตีความว่าพัง](HANDOVER.md#9-ci-แดงอยู่เพราะบิล-ไม่ใช่โค้ดพัง))
4. **ทุก gate เขียวในเครื่อง** ที่ commit ส่งมอบ — มีตารางหลักฐานอยู่ใน
   [HANDOVER.md §9](HANDOVER.md#9-ci-แดงอยู่เพราะบิล-ไม่ใช่โค้ดพัง)
   และเส้นทางที่คุยกับอุปกรณ์ถูกยืนยันกับ 80E ตัวจริงแล้ว 8 ข้อ
   ([HANDOVER.md §12.5](HANDOVER.md#125-ผลยืนยันกับไฟร์วอลล์จริง-รอบสุดท้ายก่อนส่งมอบ))
