# เอกสารส่งมอบ — FortiGate Network Automation Console

> **เขียนให้ใคร:** ทีมที่มารับงานต่อ และยังไม่เคยเห็นโปรเจกต์นี้มาก่อน
> อ่านไฟล์นี้จบแล้วต้องทำได้ตั้งแต่ติดตั้งครั้งแรก → แก้โค้ด → รัน gate → deploy
> ไม่สมมติว่าคุณรู้จักโปรเจกต์นี้ และไม่สมมติว่าคุณเคยใช้ FortiOS REST API
>
> อัปเดต **2026-11-19** · commit ส่งมอบ: `main` ที่ `6e79baa` · ทุก gate เขียวในเครื่อง
> และเส้นทางที่คุยกับอุปกรณ์ถูกยืนยันกับ FortiGate-80E ตัวจริงแล้ว ([§12.5](#125-ผลยืนยันกับไฟร์วอลล์จริง-รอบสุดท้ายก่อนส่งมอบ))

---

## สารบัญ

| | |
|---|---|
| [1. เริ่มที่นี่](#1-เริ่มที่นี่) | อ่านอะไรตามลำดับไหน |
| [2. ระบบนี้ทำอะไรได้](#2-ระบบนี้ทำอะไรได้) | ขอบเขตงาน + สิ่งที่ GUI ของ FortiGate ทำไม่ได้ |
| [3. สถาปัตยกรรม ชั้นต่อชั้น](#3-สถาปัตยกรรม-ชั้นต่อชั้น) | 3 ชั้น + ข้อมูลไหลยังไง |
| [4. ติดตั้งจากศูนย์](#4-ติดตั้งจากศูนย์) | fresh clone → ล็อกอินได้ |
| [5. เปิด HTTPS สำหรับใช้ในวง LAN](#5-เปิด-https-สำหรับใช้ในวง-lan) | runbook ครบ 3 ขั้น |
| [6. เพิ่มฟีเจอร์ใหม่ ครบ 6 ชั้น](#6-เพิ่มฟีเจอร์ใหม่-ครบ-6-ชั้น) | กฎที่ต้องทำตามทุกครั้ง |
| [7. Quality gate ทุกตัว และวิธีรัน](#7-quality-gate-ทุกตัว-และวิธีรัน) | local + CI 9 job + ratchet 3 ตัว |
| [8. กับดักที่ต้องรู้ก่อนแตะโค้ด](#8-กับดักที่ต้องรู้ก่อนแตะโค้ด) | ของที่ "ถูกตามหลักการ" แต่พังกับเครื่องจริง |
| [9. CI แดงอยู่เพราะบิล ไม่ใช่โค้ดพัง](#9-ci-แดงอยู่เพราะบิล-ไม่ใช่โค้ดพัง) | อ่านก่อนตีความว่าโค้ดเสีย |
| [10. ผลตรวจความปลอดภัย](#10-ผลตรวจความปลอดภัย) | 3 PDF + สิ่งที่จงใจไม่แก้ |
| [11. secret กับการเปิด repository เป็น public](#11-secret-กับการเปิด-repository-เป็น-public) | history สะอาด · ของที่กันไว้ |
| [12. หนี้ทางเทคนิคที่เหลือไว้ตั้งใจ](#12-หนี้ทางเทคนิคที่เหลือไว้ตั้งใจ) | 130 floating promise, container เป็น root, ฯลฯ |
| [13. งานที่เจ้าของเดิมต้องทำเอง](#13-งานที่เจ้าของเดิมต้องทำเอง) | รวมหมุน `ANTHROPIC_API_KEY` |
| [14. การดูแลประจำ](#14-การดูแลประจำ) | backup, หมุนกุญแจ, restore, อ่าน log |
| [15. ภาคผนวก](#15-ภาคผนวก) | หาโค้ดเร็ว · คำสั่งที่ใช้บ่อย · คำศัพท์ |

---

## 1. เริ่มที่นี่

### ลำดับการอ่าน ถ้ามีเวลาครึ่งวัน

1. **[README.md](README.md)** — ภาพรวม + แผนที่ฟีเจอร์ 47 หน้า + รันให้ขึ้นใน 3 คำสั่ง
2. **ไฟล์นี้ §2–§5** — ระบบทำอะไร, โค้ดอยู่ไหน, ติดตั้งจริงยังไง
3. ลงมือ: [§4](#4-ติดตั้งจากศูนย์) ติดตั้งแล้วคลิกดูของจริง 20 นาที
4. **ไฟล์นี้ §6–§8** — ก่อนแก้โค้ดบรรทัดแรก
5. **ไฟล์นี้ §9–§13** — สถานะที่ส่งมอบ: CI, ความปลอดภัย, หนี้, งานที่ค้าง

### เอกสารอื่นในโปรเจกต์ และเมื่อไหร่ควรเปิด

| ไฟล์ | เปิดเมื่อ |
|---|---|
| [README.md](README.md) | ภาพรวม · แผนที่ฟีเจอร์ · quickstart |
| [backend/README.md](backend/README.md) | หาว่าโฟลเดอร์ Go ไหนทำอะไร · เทสต์ที่ต้องมี database · ทำไม `_test.go` ไม่อยู่ใน `test/` |
| [CONTRIBUTING.md](CONTRIBUTING.md) | กฎย่อ 8 ข้อที่ห้ามลืม — อ่านได้ใน 2 นาที |

> **เอกสารที่ทีมใหม่ต้องใช้อยู่ครบใน 4 ไฟล์นี้** สิ่งที่เคยกระจายอยู่ในบันทึกภายในระหว่างพัฒนา
> — โดยเฉพาะ "เรื่องที่เคยพังมาแล้ว" — ถูกรวมมาไว้ที่ [§6](#6-เพิ่มฟีเจอร์ใหม่-ครบ-6-ชั้น)
> (วิธีเพิ่มฟีเจอร์) และ [§8](#8-กับดักที่ต้องรู้ก่อนแตะโค้ด) (กับดักก่อนแตะโค้ด) แล้ว

---

## 2. ระบบนี้ทำอะไรได้

คอนโซลนี้ทำสองงานที่ต่างกันโดยสิ้นเชิง และเป็นเหตุผลที่โปรเจกต์มีอยู่:

### 2.1 แทน GUI ของ FortiGate

อ่านและเขียน config ของไฟร์วอลล์จริงผ่าน REST API ครอบคลุม:

- **Policy & Objects** — firewall policy (สร้าง/แก้/โคลน/ย้ายลำดับ/เปิด-ปิด/ลบเป็นชุด),
  address + address group, service + service group, schedule, virtual IP (DNAT),
  IP pool (SNAT), traffic shaper + shaping policy, zone
- **Security Profiles** — IPS, AntiVirus, Web Filter, DNS Filter, Application Control,
  File Filter, SSL/SSH Inspection, Web Rating Override
- **Network** — interface (อ่านอย่างเดียว), static route, DHCP server, SD-WAN (zone / member /
  rule / performance SLA)
- **VPN** — IPsec tunnel + wizard 4 แบบ (site-to-site, remote access, custom, hub-and-spoke ADVPN+BGP)
- **System** — HA status (อ่าน), SNMP (sysinfo / community / v3 user), administrator ของตัวเครื่อง,
  log setting
- **User & Authentication บนไฟร์วอลล์** — local user, user group 4 แบบ, LDAP server, RADIUS server

### 2.2 สิ่งที่ GUI ของ FortiGate ทำไม่ได้ — คือคุณค่าจริงของโปรเจกต์นี้

| ระบบ | ทำอะไร |
|---|---|
| **Change Ledger** | ทุกการเขียนที่ผ่านคอนโซลถูกบันทึก **ว่าใคร เมื่อไหร่ ก่อน/หลังเป็นอะไร** และ revert ได้ทีละรายการ |
| **Config Drift** | เทียบ backup สองรอบ แล้วหักสิ่งที่ Change Ledger รู้จักออก → เหลือ "คนแก้นอกคอนโซล" พร้อมถามไฟร์วอลล์ว่าใคร |
| **Change Requests** | การเขียน firewall policy / VIP / security profile ถูก **ดักกลางทาง** เป็นคำขออนุมัติ (maker–checker) |
| **Audit / Review** | สแกน policy table ทั้งชุด แล้วรายงานเทียบ control ของ PCI DSS / ISO 27001 / NIST SP 800-53 พร้อมคำแนะนำแก้ และ apply/undo ได้ |
| **Rule Lifecycle** | หา rule ที่ไม่มีใครใช้ จาก hit counter จริงของอุปกรณ์ |
| **Troubleshooting** | "ทำไม A ไปหา B ไม่ได้" — เดิน policy table ทุกเงื่อนไข บอก route, rule ที่ตัดสิน, NAT, inspection, rule ที่ถูกเงาทับ พร้อม animation และปุ่ม **Fix it** (ลองก่อน / apply / undo) |
| **Wizard Config (AI)** | พิมพ์ภาษาคน → ได้ FortiOS CLI + ฟอร์มร่างที่ตรวจได้ → Apply สร้างของที่ต้องมีก่อนตามลำดับ → undo ลบเฉพาะสิ่งที่ Apply นั้นสร้าง |
| **Multi Config** | shell สด (SSH + Telnet) หลายเครื่องพร้อมกัน คุมด้วยคีย์บอร์ดเดียว + push config เป็นชุดผ่าน worker |
| **Topology** | แผนผังเครือข่าย 2D/3D จากข้อมูลสดของอุปกรณ์ + ปัก device เองให้ไฟร์วอลล์ ping เช็กสุขภาพ |
| **Notify** | 8 การตรวจ (port up/down, device unreachable, licence ใกล้หมด, CPU/memory peak, session spike, disk, config drift) → ส่ง LINE / email |
| **Backup → git** | worker ดึง config ด้วย SSH แล้ว commit ลง git repo ในตัว → diff ย้อนหลังได้ และ restore กลับได้ |
| **Local Traffic** | อ่าน traffic log จากตัวอุปกรณ์ พร้อมอธิบายว่า rule ไหนทำให้ผลเป็นอย่างนั้น |
| **Dashboard + stored metrics** | สถานะสด + กราฟย้อนหลังจาก metric ที่ scheduler เก็บทุก 5 นาที |

### 2.3 ความปลอดภัยของตัวแอปเอง

- **role 4 แบบ** — `admin` (ทุกอย่าง), `operator` (แก้ config อุปกรณ์ได้ แต่ไม่แตะ setting ของแอป
  ไม่จัดการผู้ใช้ ไม่อนุมัติ Change Request), `user`, `readonly` (อ่านทุกอย่าง เขียนไม่ได้)
- **per-user device access** — admin กำหนดว่าผู้ใช้คนไหนเข้าไฟร์วอลล์ตัวไหนได้
  (ไม่มีสิทธิ์ = ตอบ **404** ไม่ใช่ 403 โดยตั้งใจ เพื่อไม่ให้ไล่เดา device id ได้)
- **per-user device credentials** — แต่ละคนผูก **บัญชีไฟร์วอลล์ของตัวเอง** ได้ที่
  Profile ▸ Device Credentials → log ของ FortiGate จึงบอกชื่อคนจริง ไม่ใช่ `admin` ร่วมกันทุกคน
- **credential เข้ารหัส AES-256-GCM** และ **หมุนกุญแจได้** (`CRED_ENC_KEY_V<N>`)
- **2 ปัจจัย 3 แบบ** — email OTP, TOTP (QR), backup recovery code
- **device identity pinning** — จำ SSH host key และ HTTPS certificate ของอุปกรณ์แบบ TOFU
- **rate limit** — login 60/15 นาที ต่อ IP และ 10/15 นาที **ต่อบัญชี**, OTP 5/10 นาที,
  2FA 5/15 นาทีต่อบัญชี, ทั่วไป 120/นาที, AI 15/นาที, diagnostics 10/นาที
- **retention อัตโนมัติ** — backup 365 วัน (เก็บ 60 ไฟล์/เครื่อง), change record 730 วัน
  (เนื้อ before/after 180 วัน), activity log 365 วัน, session 90 วัน
- **ไม่มี self-registration** — บัญชีถูกสร้างโดย admin เท่านั้น

---

## 3. สถาปัตยกรรม ชั้นต่อชั้น

### 3.1 ภาพรวม 3 ชั้น

```
┌──────────────────────────────────────────────────────────────────────────┐
│ FRONTEND — React 19 + TypeScript + Tailwind v4 + Vite                    │
│ dev :5173 (vite dev server)   ·   prod: nginx :80 → publish 5173 / 5443  │
│ ไม่มี Ant Design · ชุด UI เขียนเองใน components/ui/                        │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │  HTTPS/JSON  → /api/...
                                 │  cookie `auth_token` (HttpOnly, JWT)
                                 │  + WebSocket (terminal) + SSE (events)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ BACKEND — Go 1.26 / Gin / GORM        :9000                              │
│                                                                          │
│   middleware:  Authorizes() → RequireApproval() → ChangeRecorder()        │
│                                                                          │
│   ├─► Postgres 16   สถานะแอป: user, role, device, credential(เข้ารหัส),   │
│   │                 change ledger, audit run, drift run, metric sample     │
│   ├─► FortiGate REST /api/v2/cmdb      อ่าน/เขียน config จริง              │
│   ├─► FortiGate REST /api/v2/monitor   runtime: CPU/session/licence/VPN    │
│   ├─► FortiGate REST /api/v2/log       traffic log (namespace ที่สาม)      │
│   ├─► SSH (x/crypto)                   uptime, ping, traceroute, terminal  │
│   ├─► Anthropic Claude                 AI wizard + audit remediation       │
│   └─► Redis 7 (คิวงาน)  ──────────────────────────┐                        │
└───────────────────────────────────────────────────┼──────────────────────┘
                                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ WORKER — Python 3.14 + netmiko                                           │
│ BRPOP: automation:jobs │ automation:config │ automation:compliance        │
│  → backup_fortigate.py  (SSH ดึง config → commit ลง git repo ในตัว)       │
│  → config_push.py       (push CLI เป็นชุดหลายเครื่อง)                     │
│  → compliance_check.py                                                    │
│ POST ผลกลับที่ /internal/*  ด้วย header X-Worker-Secret (ไม่ใช่ cookie)    │
└──────────────────────────────────────────────────────────────────────────┘
```

**ทำไมต้องมี worker แยกเป็น Python:** งานที่ใช้ **netmiko** (ไลบรารี SSH สำหรับอุปกรณ์เครือข่าย)
กินเวลาหลายสิบวินาทีต่อเครื่อง ถ้าทำใน request ของ Go จะค้าง และ scale ไม่ได้
Go จึงแค่ enqueue แล้วตอบกลับทันที

### 3.2 ไฟล์อยู่ไหน 6 ชั้น

| ชั้น | ที่อยู่ | หน้าที่ |
|---|---|---|
| 1. **FortiGate client** | `backend/services/fortigate*.go` (125 ไฟล์) | คุยกับอุปกรณ์: auth, session pool, payload builder, parser รายโดเมน |
| 2. **ระบบที่สร้างบน client** | `backend/services/` + `services/{drift,notify,platform,prompts}/` | AI, audit, drift, change ledger, change request, notify, metrics, topology, crypto |
| 3. **controller** | `backend/controller/<domain>/` (28 package) | HTTP handler — ตัวใหญ่คือ `policyobject/` |
| 4. **routes** | `backend/routes/routes.go` + `routes_*.go` 5 ไฟล์ | 351 endpoint |
| 5. **frontend** | `frontend/src/` | `api/` (52 ไฟล์) → `pages/` (37 โฟลเดอร์) → `components/` |
| 6. **worker** | `worker/` | งานที่ต้อง SSH นาน ๆ |

#### ชั้น 1 — FortiGate client

- `fortigate.go` = **client เปล่า ๆ เท่านั้น** — session auth
  (`POST /logincheck` → `ccsrftoken` → header `X-CSRFTOKEN`), `do()` / `doOnce()` (เติม
  `?vdom=root` และ re-auth เองเมื่อ session หมด), struct ร่วม, helper แปลงค่า
- `fortigate_sessionpool.go` = session pool ต่อ (device, port, login) + **circuit breaker หยุดที่ 2 ครั้ง**
  — เพราะ FortiOS ล็อกบัญชี admin หลังล็อกอินผิด 3 ครั้ง
- `fortigate_error.go` = `DeviceError{Code, HTTPStatus, Text}` — **รหัสเป็นตัวเลข**
- `fortigate_<domain>.go` = หนึ่งไฟล์ต่อหนึ่งโดเมน

> ⚠️ `services/fortigate_layout_test.go` บังคับเพดาน **1,600 บรรทัด/ไฟล์** และบังคับว่า
> `fortigate.go` ต้องไม่ใช่ไฟล์ที่ใหญ่ที่สุด เดิมเป็นก้อนเดียว 7,798 บรรทัด
> **อย่าเอาโค้ดโดเมนกลับไปใส่**

#### ชั้น 3 — controller: จุดเดียวที่ทุก handler ต้องผ่าน

`controller/policyobject/device_session.go` มีสองฟังก์ชันที่ **ทุก device handler เริ่มด้วย**:

```go
func DeviceListStaticRoutes(c *gin.Context) {
    di, ok := getDeviceInfo(c)   // โหลด device + เช็ก per-user access + เลือก credential
    if !ok { return }            // (ตอบ 404 เองแล้ว)
    fc, ok := buildClient(c, di) // หยิบ client จาก pool + ผูก request context
    if !ok { return }
    ...
}
```

**ห้าม** `services.NewFortiClient()` + `Login()` เอง (จะไม่ผ่าน pool/circuit breaker → บัญชีถูกล็อก)
**ห้าม** `fc.Logout()` (จะปิด session ที่ request อื่นกำลังใช้)
**ห้าม** เช็ก permission ซ้ำใน handler (มีที่เดียวคือ `getDeviceInfo` + `authz.go`)

#### ชั้น 4 — ลำดับ middleware สำคัญมาก

```go
protected := r.Group("")
protected.Use(middlewares.Authorizes())       // 1. cookie + session revocation + maintenance
protected.Use(middlewares.RequireApproval())  // 2. ดักการเขียนที่ต้องอนุมัติ → 202 + คิว
protected.Use(middlewares.ChangeRecorder())   // 3. บันทึกการเขียนที่ผ่านด่าน 2 ลง ledger
registerApp(protected); registerDeviceObjects(protected); ...
```

> ⚠️ **gin ผูก middleware ตอน register** route ที่ประกาศ **ก่อน** บรรทัด `Use()` จะไม่ถูกคุ้มครอง
> เลย — ไม่มี authorization, ไม่มีคิวอนุมัติ, ไม่มี ledger **register ลงกลุ่มที่ฟังก์ชันรับมาเท่านั้น
> อย่า register ลง engine**

### 3.3 Data flow ที่ต้องเข้าใจ 4 เส้น

#### (ก) อ่านของจากอุปกรณ์ — เส้นปกติ

```
หน้า React (useDeviceData + { strict: true })
  → api/policyObject.ts
  → GET /policy/device/:id/<อะไร>
  → getDeviceInfo (per-user access + credential) → buildClient (session pool)
  → FortiClient.Get... → GET /api/v2/cmdb/<path>?vdom=root
  → parse → JSON ให้ FE
```

**กฎที่พลาดมาแล้ว: "อ่านไม่ได้ ≠ ว่าง"** หน้าที่แสดงว่าไฟร์วอลล์บังคับอะไรอยู่ต้องอ่านแบบ
`{ strict: true }` และ error ต้องชนะสถานะ empty เสมอ — ตารางว่างเปล่าเพราะอ่านไม่สำเร็จ
ทำให้คนเข้าใจผิดว่า "ไม่มี rule" ซึ่งอันตรายกว่าหน้าที่ขึ้น error

#### (ข) เขียนของลงอุปกรณ์ — ผ่านคิวอนุมัติ

```
Save บนหน้า
  → POST/PATCH/DELETE /policy/device/:id/firewall-policies/...
  → RequireApproval():  ถ้า resource อยู่ใน { firewall-policy, virtual-ip, security-profile:* }
                        และคนที่กดไม่ใช่ admin
        → ไม่ถึง handler เลย · สร้าง ChangeRequest · ตอบ 202
        → admin เข้า Change Requests → Approve → ตอนนั้นจึงเขียนจริง
     ถ้าเป็น admin → ผ่านตรงไปที่ handler
  → handler เขียนอุปกรณ์
  → ChangeRecorder() บันทึก before/after + ชื่อคน ลง Change Ledger
```

#### (ค) งานที่ต้อง SSH นาน ๆ — ผ่าน worker

```
กด Backup / Push config
  → controller เขียนแถว automation_jobs + LPUSH ข้อความเข้า Redis
     ⚠️ ข้อความ **ไม่มีรหัสผ่าน** — มันพา single-use token ไป (services/jobcredential.go)
  → worker BRPOP → POST /internal/job-credentials แลก token เป็น login จริง
                 → POST /internal/ssh-host-key เช็ก host key กับ pin ชุดเดียวกับฝั่ง Go
  → netmiko SSH → ดึง config → commit ลง git repo ใน volume `config-backups`
  → POST /internal/jobs/:id/result  (header X-Worker-Secret)
```

Redis เปิด `appendonly yes` — ทุกอย่างที่ LPUSH ลงไปถูกเขียนลงไฟล์ที่ไม่มีใคร rewrite
**นี่คือเหตุผลที่ข้อความงานต้องไม่มีรหัสผ่าน**

#### (ง) AI Assistant — เส้นที่ซับซ้อนที่สุด

```
ผู้ใช้พิมพ์ภาษาคน
 → services/ai.go buildConfigPrompt:
      system prompt + CLI reference  (services/ai_prompt_fortinet.go)
      + buildLiveDeviceContext()     ← อ่านของจริงจากอุปกรณ์ 16 คำขอขนานกัน
        (address, service, ชื่อ profile, user/group, auth server, schedule, sdwan,
         ชื่อ policy, VIP, app list, ตาราง webfilter/dnsfilter)
 → Claude (tool_choice บังคับเรียก propose_device_config) → FortiOS CLI + คำอธิบาย + Impact
 → sanitizer ฝั่ง Go (ตัดคำสั่งที่ซ้ำ/ขัดกับของจริงบนเครื่อง)
 → FE parse*CLI.ts → ฟอร์มร่าง + ผังงาน SVG
 → ผู้ใช้ตรวจ/แก้ → Apply สร้างตามลำดับ dependency:
      address → service → security profile → policy
 → Fallback (undo) ลบเฉพาะสิ่งที่ Apply นั้นสร้าง ย้อนลำดับ ด้วย mkey
```

**กฎ:** AI สร้างผิด → ไปแก้ **prompt** (`services/ai_prompt_fortinet.go`)
**อย่าไป hack ที่ parser** และถ้าแก้ parser ต้องแก้ prompt คู่กันเสมอ เพราะ `parse*CLI.ts`
รองรับเฉพาะรูปแบบที่ prompt สอนให้ AI ออก

**model ต้องรองรับ forced tool use** (`tool_choice: {type:"tool"}`) — สัญญาทั้งหมดของฟีเจอร์นี้
คือการบังคับเรียก `propose_device_config` หนึ่งครั้ง Sonnet 5 / Opus 5 ทำได้
ตระกูล Fable/Mythos ตอบ 400

---

## 4. ติดตั้งจากศูนย์

### 4.1 ต้องมีอะไรบน host

| | เวอร์ชัน | หมายเหตุ |
|---|---|---|
| Docker Desktop / Engine + compose v2 | ล่าสุด | ทางหลัก — ไม่ต้องลง Go/Node/Python เลย |
| Go | 1.26+ | เฉพาะถ้าจะ `go run` / รัน `go test` ในเครื่อง |
| Node | 24+ | เฉพาะถ้าจะ `npm run dev` |
| Python | 3.14 | เฉพาะถ้าจะรันเทสต์ของ worker |
| `openssl` | — | `bootstrap.sh` ใช้ generate secret (ไม่มีก็ fallback เป็น `od`) |

เวอร์ชันพวกนี้ **ถูกบังคับให้ตรงกัน** โดย CI job `toolchain-drift` ซึ่งเทียบ pin ใน `ci.yml`
กับบรรทัด `FROM` ใน Dockerfile ที่ ship จริง — เปลี่ยนที่เดียวแล้วลืมอีกที่ = CI แดง

### 4.2 ขั้นตอน

```bash
git clone <repo-url> Network-Automation && cd Network-Automation

# 1. สร้าง .env (ห้าม cp .env.example .env — ดูเหตุผลข้างล่าง)
./scripts/bootstrap.sh                      # Windows: powershell -File scripts\bootstrap.ps1

# 2. ขึ้น stack ทั้ง 5 service
docker compose up -d --build

# 3. รอ healthy
docker compose ps

# 4. เอารหัส admin ที่ seed มา (พิมพ์ครั้งเดียวตอน seed)
docker compose logs backend | grep -i -A3 "SEEDED LOGIN"
```

เปิด <http://localhost:5173> → `admin@got.co.th` + รหัสจากข้อ 4

### 4.3 ทำไมต้องใช้ bootstrap ไม่ใช่คัดลอก env ตัวอย่าง

`.env.example` ปล่อยค่าลับ 5 ตัวว่างไว้ **โดยเจตนา** (template ที่มี secret หน้าตาเหมือนจริง
คือวิธีที่คนเผลอ commit ของจริง) แล้วมี 3 ชั้นที่จะหยุดคุณ:

1. **4 ตัวเป็น `${VAR:?}` guard ใน `docker-compose.yml`** → compose ปฏิเสธก่อนสร้าง container
2. `DATABASE_URL` มี placeholder `<POSTGRES_PASSWORD>` ที่ต้องแทนค่า
3. เติมครบ 4 ตัวแล้วก็ยังไม่ขึ้น — `backend/main.go` เรียก `platform.ValidateCredKeyConfig()`
   และ `platform.ValidateWorkerSecret()` ซึ่ง `log.Fatalf` ถ้าค่าหาย สั้นกว่า 16 ตัวอักษร
   หรือเป็น placeholder ที่รู้จัก

> 🔒 **ห้ามผ่อนปรนสองฟังก์ชันนั้น** ทั้งคู่เคยมี fallback เป็นค่า default ที่พิมพ์อยู่ใน
> `docker-compose.yml` ซึ่งแปลว่ารหัส admin ของไฟร์วอลล์จริงนอนอยู่ในฐานข้อมูล
> ใต้กุญแจที่ทุกคนที่อ่าน repo ได้ก็รู้ วิธีแก้คือ generate ค่าจริง ไม่ใช่ยอมรับค่าว่าง

`bootstrap.sh` / `bootstrap.ps1` ทำสิ่งเดียวกันทั้งสองตัว (ผลลัพธ์ byte-identical ยกเว้นค่าลับ):
generate secret 5 ตัว (hex 32 ไบต์), แทน `POSTGRES_PASSWORD` ลงใน `DATABASE_URL`,
ปฏิเสธการทับ `.env` เดิมถ้าไม่ใส่ `--force` / `-Force`, แล้วพิมพ์บอกว่าอะไรยังว่างและปิดฟีเจอร์ไหน

ค่าลับ 5 ตัวที่มันสร้าง:

| | คุ้มครองอะไร |
|---|---|
| `POSTGRES_PASSWORD` | ฐานข้อมูล (และถูกแทนลงใน `DATABASE_URL` ให้ด้วย) |
| `JWT_SECRET` | เซ็น session ของการล็อกอิน |
| `CRED_ENC_KEY` | **AES-256-GCM ครอบรหัสผ่านอุปกรณ์ทุกตัว** ← ต้อง backup |
| `REDIS_PASSWORD` | คิวงาน |
| `WORKER_SHARED_SECRET` | ด่านเดียวที่กั้น `/internal/*` |

> ⚠️ **`CRED_ENC_KEY` กู้คืนไม่ได้** ถ้าหาย รหัสผ่านอุปกรณ์ทุกตัวจะยังอยู่ในฐานข้อมูล
> ในสภาพเข้ารหัส และไม่มีอะไรอ่านมันได้อีกเลย **เก็บแยกจาก backup ของฐานข้อมูล**

### 4.4 บัญชีที่ seed มา และ role

install ใหม่เกิดมาพร้อม **บัญชีเดียว**: `admin@got.co.th`

- รหัสมาจาก `SEED_ADMIN_PASSWORD` ใน `.env` ตอน seed **ครั้งแรก**
- ไม่ตั้ง = ค่า default ที่ฝังใน `backend/config/db.go` ซึ่ง **public** (ใครอ่านซอร์สได้ก็รู้)
  — log ตอนบูตจะเตือนเสียงดังให้เปลี่ยน
- ⚠️ **seed ทำงานครั้งเดียวบนตารางที่ยังไม่มีแถว** เปลี่ยน env ทีหลังไม่มีผล
  ถ้า deploy ที่อื่นนอกจากเครื่องตัวเอง **ตั้ง `SEED_ADMIN_PASSWORD` ก่อนบูตครั้งแรก**
- บัญชีอื่นสร้างโดย admin ที่หน้า `/admin/user` — **ไม่มี self-registration**

role มี 4 ตัว: `admin` · `operator` · `user` · `readonly` (ดู [§2.3](#23-ความปลอดภัยของตัวแอปเอง))
`admin` และ `user` ถูก seed ครั้งเดียว ส่วน `operator` และ `readonly` ถูก `FirstOrCreate`
**ทุกครั้งที่บูต** เพราะ deployment ที่มีอยู่ก่อนฟีเจอร์นี้จะมีแถวใน `AppRole` แล้ว
และ guard ของ seed จะข้ามมันไปตลอดกาล

### 4.5 เพิ่มไฟร์วอลล์เครื่องแรก

`config/db.go` seed แถวตัวอย่างไว้หนึ่งแถว (FortiGate-80E ที่ `10.10.20.90`, **device id 1**)
พร้อมรหัส placeholder `CHANGE_ME` — ต้องไปใส่ของจริงก่อนจึงจะ backup หรือ deploy ได้

ขั้นตอนใช้งานจริง:

1. `/admin/devices` → เพิ่ม/แก้ไฟร์วอลล์ (host, port, ชื่อ) —
   **ฟอร์มนี้ไม่มีช่อง username/password แล้ว** (ดูข้อ 3)
2. `/admin/user` → admin กำหนด **per-user device access** ว่าใครเข้าเครื่องไหนได้
3. **Profile ▸ Device Credentials** → แต่ละคนผูกบัญชีไฟร์วอลล์ของตัวเองกับ device
   และเลือกได้ว่าอันไหน "ใช้สำหรับงานตามตาราง" (`AutomationCredentialID`)
   — นี่คือบัญชีที่ scheduler / worker ใช้เมื่อไม่มีคนกด

> เหตุผลที่ย้ายรหัสออกจาก device: เดิมคอนโซลเข้าทุกเครื่องด้วยบัญชีเดียว (ปกติ `admin`)
> ทำให้ event log ของไฟร์วอลล์เขียนว่า `admin` ทุกครั้งและแยกคนไม่ออก
> `services/devicecred.go` คือจุดเดียวที่ตัดสินว่าจะล็อกอินด้วยบัญชีอะไร

### 4.6 ตรวจว่าขึ้นจริง

```bash
docker compose ps                                   # ต้อง healthy ทั้ง 5
curl -fsS http://localhost:9000/healthz             # liveness — ไม่แตะอะไร
curl -fsS http://localhost:9000/readyz              # readiness — ping postgres + redis
docker compose logs backend | grep -i "\[FATAL\]"   # ต้องว่าง
```

`healthz` กับ `readyz` แยกกันโดยเจตนา: container มีประโยชน์เมื่อ **ต่อ Postgres และ Redis ได้**
ส่วน `GET /` ตอบ 200 ได้แม้ทั้งสองตัวล่ม ฉะนั้น healthcheck ของ compose จึงใช้ `readyz`

### 4.7 ของที่ควรรู้เรื่องเครือข่ายใน compose

- **5432 (Postgres) ไม่ถูก publish ออก host** โดยเจตนา — ฐานข้อมูลนี้เก็บรหัส admin ของ
  ไฟร์วอลล์ทุกตัวในสภาพเข้ารหัส เปิดพอร์ตคือเอารหัสเดียวมาวางกั้นระหว่างคนนอกกับไฟร์วอลล์
  ต้องการ psql ก็ `docker compose exec postgres psql -U postgres -d starter_web`
- **6379 (Redis) ไม่ถูก publish** และยังมีรหัสผ่าน — การเปลี่ยนรหัสต้อง **recreate** container
  ไม่ใช่ restart และต้องแก้ 4 จุดพร้อมกัน (`.env`, `--requirepass`, `REDIS_URL` ทั้งสองที่,
  **และ healthcheck**) ลืม healthcheck = Redis ดีทุกอย่างแต่ stack ค้างตอนบูตตลอดไป
- **frontend มี IP คงที่** `172.31.240.10` เพราะ backend เชื่อ `X-Forwarded-For`
  จาก IP นี้ตัวเดียว (`TRUSTED_PROXIES`) — ถ้าปล่อยให้ docker แจก IP เอง rate limit จะเพี้ยน
- subnet `172.31.240.0/24` เลือกมาเพื่อเลี่ยงของที่มักมีอยู่แล้ว (docker bridge, WSL2,
  และวง LAN ของไฟร์วอลล์แล็บ) — ถ้าชนบนเครื่องคุณ ตั้ง `APPNET_SUBNET` + `FRONTEND_IP` คู่กัน

### 4.8 ⛔ คำสั่งที่ทำลายข้อมูล

```bash
docker compose down -v        # ลบ volume ทั้งหมด = ฐานข้อมูล + credential ที่เข้ารหัส + git repo ของ backup
```

ปิด stack ด้วย `docker compose stop` (เก็บ container) หรือ `docker compose down` (เก็บ volume)
`docker-compose.yml` pin `name: project` ไว้ ฉะนั้น **clone ที่สองบนเครื่องเดียวกันจะไปเกาะ
volume ของตัวจริง** — ถ้าจะทดสอบ clone ต้องใส่ `-p <ชื่ออื่น>` ทุกคำสั่ง

---

## 5. เปิด HTTPS สำหรับใช้ในวง LAN

ทำเมื่อจะให้คนในบริษัทเข้าผ่าน IP ของ VM แทน `localhost`

**เหตุผลหลัก:** ปุ่มไมค์ในหน้า Wizard Config ใช้ **Web Speech API** ซึ่งเบราว์เซอร์เปิดให้ใช้
เฉพาะ **secure context**
**ผลพลอยได้ที่สำคัญกว่า:** รหัสล็อกอินและ credential ของไฟร์วอลล์เลิกวิ่งเป็น plaintext ในวง LAN

| เปิดจาก | secure context? | ไมค์ |
|---|---|---|
| `http://localhost:5173` | ✅ (spec ยกเว้นให้) | ใช้ได้ |
| `http://10.0.0.50:5173` | ❌ | **ใช้ไม่ได้** |
| `https://10.0.0.50:5443` | ✅ | ใช้ได้ |

บน HTTP ผ่าน IP เบราว์เซอร์ **ปฏิเสธทันทีโดยไม่ขึ้นกล่องขออนุญาตด้วยซ้ำ** ไม่ใช่ปัญหาการตั้งค่า
ไปไล่หาใน settings ยังไงก็ไม่เจอ

> ⚠️ อีกเงื่อนไขที่ต้องมีคู่กัน: Chrome **ไม่ได้ถอดเสียงในเครื่อง** มันสตรีมเสียงขึ้นไปถอดที่
> เซิร์ฟเวอร์ของ Google เครื่องที่ใช้งานจึงต้องออกอินเทอร์เน็ตได้ ไม่ได้ = error `network`
> แม้ HTTPS จะถูกต้องแล้ว

### ขั้น 1 — สร้าง certificate

```powershell
.\scripts\gen-lan-cert.ps1 10.0.0.50          # <- IP ที่พนักงานพิมพ์เข้ามาจริง
```
```bash
./scripts/gen-lan-cert.sh 10.0.0.50
```

> ⚠️ **อย่ารัน `.sh` ใน PowerShell** — PowerShell รัน bash script ไม่ได้ มันจะ**เงียบไปเฉย ๆ
> ไม่มี error และไม่มี cert** แล้ว container จะตกกลับไปโหมด HTTP โดยไม่มีอะไรบอก
> ใช้ `.ps1` ซึ่งเรียก `.sh` ตัวเดิมให้เองผ่าน Git Bash หรือ container

ใส่ได้หลายชื่อถ้าเข้าได้หลายทาง — **ทุกทางที่จะใช้ต้องอยู่ในนี้**:

```powershell
.\scripts\gen-lan-cert.ps1 10.0.0.50 netauto.corp.local 192.168.1.50
```

> **จุดที่คนพลาดบ่อยที่สุด:** IP ต้องอยู่ใน **subjectAltName** เบราว์เซอร์เลิกดู Common Name
> ไปนานแล้ว เข้าด้วย IP ที่ไม่ได้ระบุไว้ = ขึ้นคำเตือนต่อให้ติดตั้ง CA แล้วก็ตาม
> เปลี่ยน IP ทีหลังรันซ้ำได้ **สคริปต์ใช้ CA เดิม** → เครื่องลูกข่ายที่ trust ไว้แล้วไม่ต้องแก้อะไร

ได้ไฟล์ใน `frontend/certs/`

| ไฟล์ | คืออะไร | เอาไปไหน |
|---|---|---|
| `ca.crt` | ใบรับรองของ CA | 📤 **แจกให้เครื่องลูกข่าย** |
| `ca.key` | กุญแจลับของ CA | 🔒 อยู่เฉพาะบนเซิร์ฟเวอร์ |
| `server.crt` / `server.key` | ใบรับรองของเว็บ | 🔒 nginx อ่านเอง |

`*.key` ถูก git-ignore ไว้แล้ว **อย่าคัดลอกออกไปที่อื่น**

### ขั้น 2 — เปิด HTTPS

```bash
docker compose up -d --build frontend
docker compose logs frontend | grep entrypoint            # bash
```
```powershell
docker compose logs frontend | Select-String entrypoint   # PowerShell ไม่มี grep
```

ควรเห็น:

```
[entrypoint] TLS certificate found — serving HTTPS on 443, redirecting 80 → 443
[entrypoint] certificate is valid for:
[entrypoint]   IP Address:10.0.0.50, DNS:localhost, IP Address:127.0.0.1
```

เข้าใช้งานที่ **`https://10.0.0.50:5443`** (`http://10.0.0.50:5173` ยังเปิดได้แต่ redirect
มา HTTPS — bookmark เดิมไม่พัง)

ไม่มี cert หรือลบ `frontend/certs/` ทิ้ง = กลับไป serve HTTP อย่างเดียว ไม่พัง แค่ไมค์ใช้ไม่ได้

อย่าลืมอัปเดต `CORS_ALLOWED_ORIGINS` และ `FRONTEND_URL` ใน `.env` ให้เป็น origin ที่ publish จริง

### ขั้น 3 — ติดตั้ง `ca.crt` บนเครื่องลูกข่าย

ไม่ทำขั้นนี้ เว็บยังใช้ได้และ**ไมค์ก็ทำงาน** แต่จะขึ้นหน้าเตือนให้กด "ไปต่อ" ทุกครั้ง
และ Chrome แสดง "Not secure" ค้างไว้

ทีละเครื่อง (Windows, รันเป็น Administrator):

```powershell
Import-Certificate -FilePath .\ca.crt -CertStoreLocation Cert:\LocalMachine\Root
```

ทั้งบริษัท (แนะนำ) — **GPO**:
`Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies
→ Trusted Root Certification Authorities` → คลิกขวา **Import** → เลือก `ca.crt`
→ เครื่องลูกข่าย `gpupdate /force`

> **Firefox มี trust store ของตัวเอง** ไม่ใช้ของ Windows — ถ้าบริษัทใช้ Firefox ต้องตั้ง policy
> `Certificates.Install` เพิ่ม (แต่ Web Speech API ใช้ได้เฉพาะ Chrome/Edge อยู่แล้ว ไมค์จึงไม่กระทบ)

### ตรวจว่าสำเร็จ

```bash
openssl x509 -in frontend/certs/server.crt -noout -ext subjectAltName   # cert ครอบ IP ที่ใช้จริงไหม
curl -k -I https://10.0.0.50:5443/                                      # เซิร์ฟเวอร์ตอบ HTTPS ไหม
curl -I https://10.0.0.50:5443/                                         # เครื่องลูกข่าย trust CA แล้วไหม
```

### เจอปัญหา

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| ปุ่มไมค์เทากดไม่ได้ | หน้านี้ไม่ใช่ secure context | เปิดผ่าน `https://` |
| "Your connection is not private" | เครื่องยัง trust `ca.crt` ไม่ได้ | ทำขั้น 3 |
| trust CA แล้วยังเตือน | IP ที่พิมพ์ไม่อยู่ใน SAN | รัน `gen-lan-cert` ใหม่ใส่ IP นั้น (CA เดิมใช้ต่อได้) |
| error `network` ตอนพูด | Chrome ส่งเสียงไป Google ไม่ถึง | เช็กว่าเครื่องออกเน็ตได้ / proxy ไม่บล็อก |
| `entrypoint` บอกว่าไม่เจอ cert | mount ไม่ติด หรือชื่อไฟล์ผิด | ต้องเป็น `frontend/certs/server.crt` + `server.key` เป๊ะ |
| เบราว์เซอร์อื่นไม่มีปุ่มไมค์ | Web Speech API รองรับแค่ Chrome/Edge | ใช้ Chrome หรือ Edge |

### หมายเหตุการดูแล

- **server cert อายุ 825 วัน · CA อายุ 10 ปี** — ใกล้หมดอายุรัน `gen-lan-cert` ซ้ำแล้ว
  `docker compose restart frontend` เท่านั้น ไม่ต้องแตะเครื่องลูกข่าย
- **ไม่ได้เปิด HSTS โดยตั้งใจ** — บน LAN ที่เข้าด้วย IP มันจะ pin เบราว์เซอร์ไว้กับ HTTPS ถาวร
  รวมถึงตอนที่ VM ถูกสร้างใหม่โดยยังไม่มี cert และ HSTS ที่ผูกกับ IP ล้างยากมากเมื่อกระจายไปทั้งฟลีต
- ยังเปิด **5173 (HTTP)** ไว้เพื่อ redirect เท่านั้น จะปิดจริงให้ลบ mapping `"5173:80"`
  ออกจาก `docker-compose.yml`
- **`Permissions-Policy` ใน `frontend/nginx/common.conf` ต้องไม่มี `microphone`**
  — การไม่ระบุ feature ไว้คือปล่อยให้เป็นค่า default (`self`) header นี้จึงระบุเฉพาะสิ่งที่
  **ปฏิเสธ** ใส่ `microphone=()` เข้าไปจะทำให้ปุ่มไมค์ตายเงียบ ไม่มี prompt ไม่มี error
  เช่นเดียวกับ `clipboard-write` ซึ่งมี 9 หน้าที่ใช้ปุ่ม copy

---

## 6. เพิ่มฟีเจอร์ใหม่ ครบ 6 ชั้น

> ตัวอย่างที่ใช้อ้างอิงคือ **Static Routes** ซึ่งเป็นเส้นที่สะอาดที่สุดในโปรเจกต์ —
> เปิด 5 ไฟล์นี้คู่กันแล้วลอกโครงได้เลย:
> `services/fortigate_route.go` → `controller/policyobject/device_route.go` →
> `routes/routes_device_system.go` → `api/policyObject.ts` → `pages/static-routes/`

### ขั้น 0 — ยืนยัน schema ก่อนเขียนโค้ด (ห้ามข้าม)

ถาม schema จากอุปกรณ์ตรง ๆ (GET อย่างเดียว ไม่เปลี่ยนอะไร):

```bash
# ชื่อ field + ชนิด + mkey ที่เฟิร์มแวร์ตัวนี้รู้จักจริง
curl -sk "https://10.10.20.90/api/v2/cmdb/router/static?action=schema&vdom=root" \n     -H "Authorization: Bearer <api-token>"
# ค่าจริงที่เครื่องเก็บอยู่ตอนนี้
curl -sk "https://10.10.20.90/api/v2/cmdb/router/static?vdom=root" \n     -H "Authorization: Bearer <api-token>"
```

หรือทาง SSH: `show router static` / `get router static`
⚠️ cookie jar และ token ห้ามเขียนลงโฟลเดอร์โปรเจกต์ (ดู [§8.6](#86-กับดักของตัวแอป))

**กฎแปลงชื่อ CLI → REST path:** ทุกคำยกเว้นคำสุดท้ายต่อด้วย `.` แล้วคั่น `/` ก่อนคำสุดท้าย
`config firewall schedule recurring` → `firewall.schedule/recurring`

### ขั้น 1 — client: `backend/services/fortigate_<domain>.go`

**ห้ามเขียนลง `fortigate.go`** (เพดาน 1,600 บรรทัด + ห้ามเป็นไฟล์ใหญ่สุด) โดเมนใหม่ = ไฟล์ใหม่

- struct สำหรับ **อ่าน** และสำหรับ **เขียน** เป็นคนละตัว — อันแรกคือสิ่งที่หน้าจอต้องการ
  อันหลังคือสิ่งที่ FortiOS ยอมรับ
- ลบต้องระบุ **mkey** เสมอ
- เทียบ error ด้วย `errors.As` + `DeviceError{Code}` **ไม่ใช่ substring**

### ขั้น 2 — controller: `backend/controller/policyobject/device_<domain>.go`

เริ่มด้วย `getDeviceInfo()` + `buildClient()` เสมอ (ดู [§3.2](#32-ไฟล์อยู่ไหน-6-ชั้น))
การแปลงค่าจากฟอร์มทำในไฟล์นี้ ไม่ใช่ใน service

### ขั้น 3 — routes: ลงใน registrar ที่ตรงพื้นที่

`routes_app` (ตัวแอป) · `routes_device_objects` (object บนอุปกรณ์) · `routes_device_system`
(ตัวเครื่อง/network/VPN) · `routes_analytics` (มองย้อนหลัง) · `routes_automation` (AI/คิว/แจ้งเตือน)

- ต้องอยู่ในกลุ่ม `protected` ที่ฟังก์ชันรับมา **เท่านั้น**
- mkey ที่อาจมี `/` (เช่น URL) → ดูวิธีที่ `web-rating-overrides/:url` ทำ + patch RawPath ใน `main.go`
- admin-only → ใส่ guard แบบเดียวกับ `authz.go` และเพิ่มเคสใน `authz_guard_test.go`

### ขั้น 4 — API layer: `frontend/src/api/`

- list ที่หน้าเอาไป**แสดงว่าไฟร์วอลล์บังคับอะไรอยู่** ต้องรองรับ `opts` แล้วหน้าเรียกด้วย
  `{ strict: true }` · แบบ lenient (`catch → []`) เหลือไว้สำหรับ dropdown/picker เท่านั้น
- `policyObject.ts` **โตอีกไม่ได้** (อยู่ใน layout budget แล้ว) โดเมนใหม่ = ไฟล์ใหม่ใน `api/`

### ขั้น 5 — page: `frontend/src/pages/<name>/`

- ใช้ `useDeviceData` + `DeviceStates` ครอบตาราง — **อ่านไม่ได้ ≠ ว่าง**
- **ฟอร์มแก้ไข: อ่านไม่ได้ต้องไม่ render ฟอร์ม** (`ProfileLoadGuard`)
  เคยมีบั๊ก: getter คืน `null` → ฟอร์มขึ้นค่า default ครบ + ปุ่ม Save เปิด → กด = ทับโปรไฟล์จริง
- โหลดหลายอย่างตอนเปิดหน้า **ยิงพร้อมกัน** ไม่ใช่ chain
- ใช้ `components/ui/` ที่มีอยู่ · **ห้ามเพิ่ม Ant Design กลับเข้ามา** (ถอดออกหมดแล้ว)
- device ที่เลือกมาจาก `DeviceContext` บน navbar เท่านั้น **อย่าใส่ device selector ในหน้า**

### ขั้น 6 — sidebar: `frontend/src/components/structure/sidebar/data.tsx`

- `name` = route ใต้ `/admin` + React key → ต้องตรงกับ `src/routes/mainroutes.tsx`
- `keywords` ไม่ใช่ของประดับ — คนค้นเมนูด้วยชื่อ FortiOS (`"phase1"`, `"ips"`, `"policy"`)
  ไม่ใช่ label ที่เราตั้ง
- endpoint เป็น admin-only → ต้องซ่อนเมนูด้วย `isAdmin` ให้ตรงกัน
- เลือก section ตาม **ธุระของหน้า ไม่ใช่เมนูของ FortiGate**: Automation = เปลี่ยนของ/สั่งงาน ·
  Diagnostics = ถามอุปกรณ์เดี๋ยวนี้ · Analytics = มองย้อนหลังไม่เขียนอุปกรณ์ ·
  Log & Report = แสดงบันทึก

### ขั้น 7 — i18n

**ไม่มี `t()` ในหน้า** — แปลตอน render โดย key คือ **ข้อความอังกฤษเอง**
(ภาษาต้นทางคืออังกฤษ · รองรับ EN / TH / ZH)

```bash
cd frontend
node scripts/i18n-extract.mjs                   # เขียน scripts/i18n-strings.json ใหม่
node scripts/i18n-missing.mjs                   # เหลืออะไรที่ยังไม่แปล
npm run test -- src/i18n/dictionary.test.ts
```

เติมคำแปลใน `src/i18n/dictionary/{th,zh}/<area>.ts` หรือใส่ `dictionary/keep.ts`
ถ้าคำนั้นควรเป็นอังกฤษจริง (ชื่อโปรโตคอล/ผลิตภัณฑ์/หน่วย)
**ต้อง commit `scripts/i18n-strings.json` ที่ regenerate แล้วไปด้วย** — ไม่งั้น gate จะเขียว
กับไฟล์เก่า ซึ่งแย่กว่า gate ที่แดง

### ขั้น 8 — เทสต์ + budget

ดู [§7](#7-quality-gate-ทุกตัว-และวิธีรัน)
กฎสำคัญ: **เทสต์ที่คุมบั๊กต้องลองรันกับโค้ดเก่าก่อน แล้วเห็นมัน fail** —
เทสต์ที่ผ่านทั้งก่อนและหลังไม่ได้คุมอะไร และ stub ต้องเลียนแบบ semantics จริง
ไม่ใช่แค่คืนค่า (stub ที่ throw ทุกกรณีจะผ่านทั้งเวอร์ชันเก่าและใหม่)

### ขั้น 9 — ยืนยันกับเครื่องจริง

**ยังไม่เห็นของขึ้นบนอุปกรณ์จริง = ยังไม่เสร็จ** แล้วลบ test object ด้วย **mkey** เสมอ
รายการที่ใช้ทดสอบรอบสุดท้ายก่อนส่งมอบอยู่ใน [§12.5](#125-ผลยืนยันกับไฟร์วอลล์จริง-รอบสุดท้ายก่อนส่งมอบ)
และอาการของเครื่องแล็บที่ดูเหมือนบั๊กอยู่ใน [§8.7](#87-เครื่องแล็บ-อาการที่ดูเหมือนบั๊กแต่ไม่ใช่)

---

## 7. Quality gate ทุกตัว และวิธีรัน

### 7.1 ชุดคำสั่งครบ (local)

```bash
# ── Backend ────────────────────────────────────────────────
cd backend
go build ./...
go vet ./...
gofmt -l .                  # ⚠️ ต้องไม่พิมพ์อะไรออกมา (แก้ด้วย gofmt -w .)
go test ./...               # รวม layout budget ทั้ง 2 ตัว + handler coverage check

# ── Frontend ───────────────────────────────────────────────
cd frontend
npm run test                # vitest
npm run build               # tsc -b && vite build  (type check อยู่ในนี้)
npm run lint:budget         # ratchet สองทาง

# ── i18n ───────────────────────────────────────────────────
cd frontend
node scripts/i18n-extract.mjs && node scripts/i18n-missing.mjs
npm run test -- src/i18n/dictionary.test.ts

# ── Worker ─────────────────────────────────────────────────
cd worker
python -m unittest discover -p 'test_*.py'
```

**ตัวเลขที่วัดได้ตอนส่งมอบ (2026-11-19):** backend 40/40 package ผ่าน ·
frontend 2,162 test ใน 128 ไฟล์ · lint budget 17 finding ที่รู้จัก · worker 110/110
**อย่าลอกตัวเลขจากเอกสาร** — มันเดินตลอดเวลา ให้รันแล้วอ่านจากผลจริง
(`/fg-preflight` รันทั้งหมดแล้วพิมพ์ตัวเลขสดให้)

### 7.2 กับดักของตัว gate เอง

- **`npm run test` เท่านั้น ห้าม `npx vitest`** — ถ้า cwd มี drive letter ตัวพิมพ์เล็ก (`c:\...`)
  จะโหลด vitest runner ซ้อนสองตัวแล้วรายงานว่า "no tests" ทุกไฟล์ npm script normalise ให้แล้ว
- **`npx tsc --noEmit` ที่ root ไม่ได้ตรวจอะไรเลย** — `frontend/tsconfig.json` เป็น solution-style
  (`"files": []` + `references`) input จึงเป็นศูนย์ไฟล์ และ **เขียวเสมอ**
  จะตรวจจริงใช้ `npx tsc -p tsconfig.app.json --noEmit` หรือแค่ `npm run build` ก็พอ
- **อย่า `pip install -r worker/requirements.txt` ก่อนรันเทสต์ของ worker** — suite stub
  netmiko/redis เอง ติดตั้งของจริงแล้วจะกลายเป็นเทสต์คนละอย่างกับที่ CI รัน

### 7.3 Ratchet 3 ตัว — ขึ้นก็ fail ลงก็ fail

นี่คือของที่ลืมบ่อยที่สุด: **ลดจำนวนลงแล้วไม่ lock ค่าใหม่ ก็ fail**

| budget | ไฟล์ | เพดาน | แก้ยังไง |
|---|---|---|---|
| ขนาดไฟล์ (บรรทัด) | `backend/test/layout-budget.json` | soft 1,200 บรรทัด — `.go` / `.ts` / `.tsx` ทั้ง backend + `frontend/src` | แยกไฟล์ แล้วแก้ json |
| ขนาดไฟล์ (ไบต์) | `backend/test/layout-budget-bytes.json` | 48 KB | เหมือนกัน — ปัจจุบันเหลือเฉพาะ dictionary ของ i18n ซึ่งเป็น **data** จึงอยู่ในรายการต่อไป |
| `fortigate*.go` | `services/fortigate_layout_test.go` | **hard 1,600** + `fortigate.go` ห้ามใหญ่สุด | แยกเป็น `fortigate_<domain>.go` |
| ESLint | `frontend/lint-budget.json` | ค่าปัจจุบันรายกฎ | `npm run lint:budget -- --fix` แล้ว commit json |
| coverage | `backend/test/coverage-budget.json` | floor รายแพ็กเกจ | เพิ่มเทสต์แล้วยกค่าใน json |

```bash
cd backend && UPDATE_LAYOUT_BUDGET=1 go test ./test/ -run TestOversizedFiles   # regenerate ทั้งสองตัว
```

**กฎการแยกไฟล์ที่มาจากการทำสำเร็จ 3 ครั้ง:**

1. ถ้าไบต์ส่วนใหญ่เป็น **ข้อความ** ใน string literal → มันคือ data ไม่ใช่ code
   → `//go:embed` + เทสต์ checksum (ดู `services/ai_prompt_fortinet.go` 64 KB → 2.3 KB)
2. ถ้าไม่ใช่ → **ย้ายทั้งก้อนโดยไม่แก้** และ **diff ต้องอ่านออกว่าเป็นการ MOVE**
   ถ้า reviewer ดูไม่ออก = การแยกนั้นเปลี่ยนพฤติกรรมที่ไหนแล้ว
3. hook ที่ต้องใช้ setter ของหน้าหลายตัว → ให้รับ **callback 1–2 ตัว** แทน
   (signature ที่ไล่ setter 11 ตัวคือคำอธิบาย state ของหน้าฉบับที่สอง และมันจะเพี้ยนทันที
   ที่มีคนเพิ่มตัวที่ 12)

### 7.4 CI — 9 job (`.github/workflows/ci.yml`)

| job | ทำอะไร | บล็อก |
|---|---|---|
| `backend` | build · vet · **gofmt** · **staticcheck (0 finding)** · test | ✅ |
| `coverage` | coverage ratchet — รัน suite ที่ต้องมี database **ครบทั้งหมดที่เดียว** | ✅ |
| `race` | `go test -race ./...` — **ที่เดียวที่ race detector รัน** | ✅ |
| `frontend` | vitest · build (type check อยู่ในนี้) · **lint budget** | ✅ |
| `worker` | `python -m unittest` (ไม่ install requirements โดยตั้งใจ) | ✅ |
| `secrets` | `.env` / `cookies.txt` / `fg.txt` ต้องไม่ถูก track + gitleaks | ✅ |
| `docker` | `docker compose config --quiet` → `docker compose build` | ✅ |
| `toolchain-drift` | เวอร์ชัน Go/Node/Python ใน CI ต้องตรงกับ Dockerfile ที่ ship จริง | ✅ |
| `vuln` | govulncheck · `npm audit` · `pip-audit` | ⚠️ **ไม่บล็อก** (`continue-on-error`) |

**smoke suite (playwright) ไม่อยู่ใน CI โดยตั้งใจ** — ต้องมี FortiGate จริงที่ต่อถึง:

```bash
docker compose up -d
cd frontend && npm run test:smoke
```

### 7.5 สองอย่างที่รันบน Windows ไม่ได้

เครื่องที่พัฒนาโปรเจกต์นี้เป็น Windows ซึ่งไม่มี cgo ที่ใช้ได้ ฉะนั้น:

**staticcheck** (hard gate ที่ 0 finding) — ต้องรันใน container
ก่อน commit ที่ unexport หรือลบอะไรออก ให้รันตัวนี้:

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "/c/Network-Automation/backend:/src" -v staticcheck-cache:/root/.cache -w /src \
  golang:1.26-alpine sh -c \
  "go install honnef.co/go/tools/cmd/staticcheck@2025.1.1 >/dev/null 2>&1 && /go/bin/staticcheck ./..."
```

**`go test -race`** — ต้องรันใน container เช่นกัน และ ⚠️ **ต้อง mount repo ทั้งก้อน ไม่ใช่แค่
`backend/`** — mount แค่ backend จะทำให้ `TestOversizedFilesByBytesDoNotGrow` fail ด้วย
"no longer oversized" 5 รายการ เพราะไฟล์ dictionary ของ frontend ไม่อยู่ใน container
หน้าตาเหมือน ratchet พังจริงเป๊ะ ๆ แต่เป็น artefact ของการ mount:

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "/c/Network-Automation:/src" -w /src/backend golang:1.26 \
  go test -race ./...
```

### 7.6 เทสต์ที่ต้องมี database

หลาย suite จะ **skip** ถ้าไม่ได้ตั้ง DSN — หนึ่ง environment variable ต่อหนึ่ง package
(`SEED_DB_TEST_DSN`, `POLICYOBJECT_DB_TEST_DSN`, …) รายการครบอยู่ใน job `coverage` ของ `ci.yml`
ซึ่งเป็นที่เดียวที่มันรันพร้อมกันทั้งหมด

> ⛔ **ชี้ไปที่ container ชั่วคราวเท่านั้น ห้ามชี้ไปที่ฐานข้อมูลของคอนโซลเอง — มัน DROP ตาราง**
> และ **ห้ามใช้ sqlite แทน** (semantics ต่างกันพอที่จะทำให้เทสต์ผ่านทั้งที่โค้ดผิด)

```bash
docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name pg-test postgres:16-alpine
SEED_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
  go test ./config/ -v
```

> ⚠️ **ระวัง gate ที่เขียวเพราะไม่ได้รัน** เคยเกิดมาแล้ว: coverage floor ถูกบันทึกจากรอบที่
> 11 suite ที่ต้องใช้ DB ถูก skip เงียบ ๆ → ตัวเลขดูดีแต่ไม่ได้คุมอะไร
> ถ้าเห็น `--- SKIP` เยอะผิดปกติ ให้สงสัยว่า DSN ไม่ได้ตั้ง

### 7.7 ทดสอบ handler ที่คุยกับอุปกรณ์ โดยไม่มี FortiGate

`controller/policyobject` มี seam ของ device client ให้สลับ fake เข้าไปได้
(interface `deviceClient` ที่ handler test ทุกตัวใช้) ฉะนั้น logic ของ handler —
permission, การแปลงค่า, การจัดการ error — ทดสอบได้ครบโดยไม่ต้องมีไฟร์วอลล์
สิ่งที่ fake แทนไม่ได้คือ **schema จริงของเฟิร์มแวร์** ซึ่งต้องยืนยันกับเครื่องจริงเท่านั้น

---

## 8. กับดักที่ต้องรู้ก่อนแตะโค้ด

> ทุกข้อในนี้เคยทำให้โค้ดที่ "ถูกตามหลักการ" พังกับเครื่องจริง — ไม่ใช่ทฤษฎี

### 8.1 🔴 ห้าม DELETE ที่ CMDB collection URL

```bash
curl -X DELETE ".../api/v2/cmdb/firewall/policy?vdom=root"     # ⛔ ตอบ 200 แล้ว policy หายทั้งเครื่อง
curl -X DELETE ".../api/v2/cmdb/firewall/policy/12?vdom=root"  # ✅ ลบ policy 12
```

เคยเกิดขึ้นจริงในโปรเจกต์นี้ และ**กู้ไม่ได้** เพราะเครื่องแล็บตั้ง `cfg-save automatic`
และไม่มี revision **ลบต้องระบุ mkey เสมอ**

ของกันไว้แล้ว 3 ชั้น — อย่าแก้ให้ผ่อนปรน:
`buildRevertRequest` ปฏิเสธถ้าไม่มี mkey · `TestBuildRevertRequest_NeverDeletesACollection`
คุมไว้ · และ `respondDeviceError` ไม่เคยสร้าง request แบบไม่มี mkey

### 8.2 🔴 schema บอกว่ามี ≠ ใช้ได้จริง

ตัวอย่างที่ชัดที่สุด `firewall/vip` → field `status` (ยืนยันบน FGT80E / FortiOS 7.2.10):

| ถาม | ตอบ |
|---|---|
| `?action=schema` | **มี** `status` · type `option` · `disable\|enable` · default `enable` |
| REST POST/PUT ส่ง `"status":"disable"` | **200/201 สำเร็จ** แล้ว **ทิ้งค่าเงียบ ๆ** · อ่านกลับได้ `enable` |
| CLI `set status disable` | **`command parse error` · `-61`** — ไม่มี field นี้จริง |

→ **กฎ: ยืนยันชื่อจาก schema แล้ว "เขียนจริง 1 ครั้ง อ่านกลับมาเทียบ" ก่อนจะสร้าง UI ให้มัน**
อ่านกลับได้ไม่ตรงกับที่ส่ง = field นั้นใช้ไม่ได้ **ห้ามทำปุ่มให้มัน**
ปุ่มที่กดแล้วขึ้น "สำเร็จ" โดยไม่มีอะไรเปลี่ยน แย่กว่าไม่มีปุ่ม
(เกือบ ship ฟีเจอร์เปิด/ปิด VIP แบบนี้มาแล้ว จับได้ตอน verify กับเครื่องจริง)

ญาติของกับดักนี้: **ไฟร์วอลล์ที่เป็น flow-based inspection ตอบ 200 แล้วทิ้ง field ของ
`ssl-ssh-profile` ไปเกือบหมด**

### 8.3 🔴 รหัส error ของ FortiOS เป็นตัวเลข ไม่ใช่ substring

```go
// ⛔ ผิด — จับ -5, -50..-59, -500..-599, -518 และ object ชื่อ `site-5` หรือ port range `1-5` ไปด้วย
if strings.Contains(err.Error(), "-5") { /* "มีอยู่แล้ว" */ }

// ✅ ถูก
var de *services.DeviceError
if errors.As(err, &de) && de.Code == -5 { /* ชื่อซ้ำ → ใช้ซ้ำ */ }
```

บั๊กที่เกิดจริง: create ที่ล้มจริงถูกอ่านเป็น "มีอยู่แล้ว" → wizard รายงานสำเร็จ
แล้วไปสร้าง policy ที่อ้าง object ที่ไม่เคยถูกสร้าง

รหัสที่เจอบ่อย: `-5` ชื่อซ้ำ · `-3` entry not found in datasource · `-8` tunnel-route ·
`-23` ถูกใช้งานอยู่ (409) · `-56` category ของ FortiGuard ไม่รู้จัก · `-61` no reset ·
`-149` auth trap · `-518` object set operator error · `-651` reserved hyphen

### 8.4 Reuse before create

ชื่อซ้ำบน FortiGate = `error -5` มี object ที่ตรงอยู่แล้วให้ **ใช้ซ้ำ** ทุก create path
ต้อง **idempotent** และกัน duplicate ด้วยการเทียบรหัสตัวเลข ทั้งโค้ดและ prompt ของ AI ยึดกฎนี้

### 8.5 สาม namespace ที่ไม่เหมือนกัน

`/api/v2/cmdb` (config) · `/api/v2/monitor` (runtime) · `/api/v2/log` (บันทึก) — คนละชุดกัน
และ `serial` / `version` / `build` อยู่บน **envelope** ของ response ไม่ได้อยู่ใน `results`
⚠️ **filter ของ log API fail แบบ open** — กรองไม่ติด = ได้ทุกแถวกลับมา ไม่ใช่ศูนย์แถว

### 8.6 กับดักของตัวแอป

- **`cookies.txt` / `fg.txt` ห้ามอยู่ในโฟลเดอร์โปรเจกต์** — ทั้งสองเคยหลุดขึ้น git มาแล้ว
  (`cookies.txt` = `auth_token` ของแอป, `fg.txt` = `ccsrftoken` + `APSCOOKIE` ของไฟร์วอลล์)
  CI job `secrets` fail ถ้าไฟล์พวกนี้ถูก track · เขียนไว้ที่ `${TMPDIR:-/tmp}` แล้ว `rm -f` เมื่อเสร็จ
- **ห้ามย้าย `ChangeRecorder()` ลงไปหลัง route** — gin ผูก middleware ตอน register
  route ที่ประกาศก่อนจะหายจาก ledger เงียบ ๆ
- **`diagnose` ไม่ใช่คำกริยา read-only** — `diagnose sys session clear` ตัดเซสชันทั้งเครื่อง,
  `diagnose sys session filter` ตั้ง state ระดับ global ที่ค้างข้ามเซสชัน,
  `diagnose vpn ike restart` ล้มทันเนล ฉะนั้น allow-list ของ `POST /config-deploys/query`
  เขียน sub-command ทีละตัว (`allowedDiagnosePatterns`) **ห้ามเติม prefix `^\s*diagnose\s+`
  กลับเข้าไป** · endpoint นี้ต้องผ่าน admin/operator **และ** per-user device grant
- **undo ทีละ object ด้วยการ replay CLI ทำไม่ได้** สำหรับของที่ถูกแก้/ลบนอกคอนโซล —
  rollback ใช้ `monitor/system/config/restore` คือคืนไฟล์ทั้งไฟล์
- **mkey ที่มี `/`** (เช่น URL ของ web-rating override) ต้องพึ่ง patch RawPath ใน `main.go`
  ไม่งั้น 404 ทุกเส้นที่เป็น by-key
- **ตัด string ที่เป็นภาษาไทยด้วยการ slice ไบต์ทำให้ Postgres ปฏิเสธทั้งแถว** — ใช้
  `TruncateUTF8`
- **`middleware/` เป็นโฟลเดอร์ แต่ package ชื่อ `middlewares`** ทุก import ต้องมี alias
  (ตัดสินใจไม่ rename โดยเจตนา — มันถูกบันทึกไว้ใน `backend/README.md` แทน)

### 8.7 เครื่องแล็บ: อาการที่ดูเหมือนบั๊กแต่ไม่ใช่

FortiGate-80E ที่ `10.10.20.90` (device id 1 · FortiOS 7.2.10 build 1706 · hostname `NGFW-Testing`)

- **licence หมดอายุ** → ฟีเจอร์ที่พึ่ง FortiGuard (web filter category, IPS signature, AV)
  ตอบไม่ครบ ไม่ใช่โค้ดผิด
- **16 port ไม่ได้เสียบสาย** → interface ขึ้น down เป็นเรื่องปกติ
- **CPU idle 0%** → กราฟดูแปลกได้
- ตารางอาการ/สาเหตุฉบับเต็มอยู่ใน `references/verify-live.md` — **อ่านก่อนสรุปว่าโค้ดผิด**

> 🔒 มีอีกเครื่องชื่อ **"Firewall-Real"** ที่ `10.0.99.254` — **read-only เด็ดขาด**
> ห้ามเขียนและห้ามทดสอบ authentication ใส่โดยไม่ถามก่อน

### 8.8 ห้ามเอา web scanner ไปยิงไฟร์วอลล์

ZAP / scanner อื่น ๆ **ชี้ไปที่คอนโซลเท่านั้น ห้ามชี้ไปที่ FortiGate** — คำขอเป็นพัน ๆ ครั้ง
รวมการล็อกอินซ้ำ ๆ จะทำให้บัญชี admin ถูกล็อก (`admin-lockout-threshold 3`)
และมีคนต้องไปกู้เครื่อง และ **ไม่ใช้ ZAP active scan** เพราะมันยิง payload ลงทุกฟอร์ม
ซึ่งที่นี่แปลว่าเขียน object จริงลงไฟร์วอลล์จริง

---

## 9. CI แดงอยู่เพราะบิล ไม่ใช่โค้ดพัง

**นี่คือสิ่งแรกที่ทีมใหม่จะเห็นแล้วเข้าใจผิด** — อ่านหัวข้อนี้ก่อนตีความติ๊กแดง

GitHub Actions run **#156** บน `8f21aab` แสดงว่า **job ทั้ง 9 ตัว fail ที่ 2 วินาที** เท่ากันหมด
annotation บอกตรง ๆ ว่า:

> The job was not started because recent account payments have failed or your spending limit needs
> to be increased. Please check the 'Billing & plans' section in your settings

**GitHub ไม่ได้รันโค้ดของ repository นี้แม้แต่บรรทัดเดียว** มันปฏิเสธที่จะจัดสรร runner
นั่นคือเหตุผลที่ทุก job ตายที่นาทีเดียวกันเป๊ะ รวม `No secrets in the tree` และ
`Toolchain versions match the shipped images` ซึ่งไม่แตะทั้ง Go และ Docker

### แยกจาก failure จริงได้ในหนึ่งแวบ

| CI แดงเพราะบิล | failure จริง |
|---|---|
| **ทุก** job แดง ไม่ใช่บางตัว | แดงเฉพาะที่เกี่ยว |
| ทุกตัวใช้เวลาเท่ากันและสั้นผิดปกติ (~2 วินาที) | ใช้เวลาเป็นนาที |
| job ที่เป็นไปไม่ได้ว่าจะกระทบก็แดงด้วย | — |
| commit ไม่ได้แตะไฟล์ workflow | — |

### วิธีแก้

1. **Settings → Billing and plans** — ซ่อม payment method หรือเพิ่ม spending limit
   repo นี้เป็น **Private** ฉะนั้น Actions minutes ถูกคิดเงิน โควตาหมด = job ไม่เริ่ม
2. เปิด run #156 → **Re-run jobs** — **ไม่ต้อง commit ใหม่** เพราะโค้ดไม่ได้ผิด
   โควตารีเซ็ตเองตามรอบบิลด้วย รอแล้ว re-run ก็ได้
3. ทางเลือก: ตั้ง **self-hosted runner** แล้วไม่ต้องใช้ minutes ที่คิดเงิน

### เรื่องการเปิด repo เป็น public เพื่อเอา minutes ฟรี

public repo ได้ Actions minutes ไม่จำกัด จึงดูเป็นทางออกที่ง่าย — ทำได้ทางเทคนิค
แต่อ่าน [§11](#11-secret-กับการเปิด-repository-เป็น-public) ก่อนตัดสินใจ มีของที่ควรย้ายออก
จากเอกสารชุดนี้ก่อน และทางที่ตรงกว่าคือย้าย repo เข้า organisation ของทีมแล้วใช้โควตาของตัวเอง

### การตัดสินใจของเจ้าของเดิม (2026-11-19)

ถูกถามว่าจะจ่าย / รอ / หรือตั้ง self-hosted runner — เจ้าของเลือก **ไม่ทำทั้งสามอย่าง**
และยอมรับว่า CI แดงอยู่บน `8f21aab` เพราะ:

- spending limit ค่าเริ่มต้นของ GitHub คือ **$0** โควตาหมดจึง **หยุด** Actions ไม่ใช่เรียกเก็บเงิน
  — ไม่มีหนี้เกิดขึ้น และไม่มีอะไรด่วน
- โควตารีเซ็ตเองตามรอบบิล กด Re-run หลังจากนั้นไม่มีค่าใช้จ่ายและไม่ต้อง commit
- โปรเจกต์กำลังถูกส่งมอบให้ทีมอื่น ซึ่งจะ host ใต้ organisation และโควตาของตัวเอง
  จ่ายตอนนี้อาจไม่ได้อะไรเลย

**→ ทีมใหม่: ย้าย repo เข้า organisation ของคุณแล้วกด Re-run ก็ได้ผลลัพธ์จริงทันที**

### หลักฐานว่าโค้ดเขียว — รัน local ทุก job

`gh` ไม่ได้ติดตั้งบนเครื่องที่พัฒนา ฉะนั้นผลจาก GitHub Actions ของ `c6a2d48` และ `8f21aab`
**ไม่เคยถูกเห็น** จึงรันคำสั่งของทุก job ในเครื่องแทน และเขียวทั้งหมด:

| job | รันอย่างไร | ผล |
|---|---|---|
| `backend` | build · vet · gofmt · test | **40/40 package** |
| `backend` staticcheck | container `golang:1.26-alpine` | **exit 0** |
| `race` | `go test -race ./...` ใน `golang:1.26` | 40/40 · **0 DATA RACE** |
| `frontend` | vitest · build · lint:budget | **2,162 test** · 17 lint finding ที่รู้จัก |
| `worker` | `unittest discover` | **110/110** |
| `toolchain-drift` | รัน sed comparison ของ job เองด้วยมือ | Go/Node/Python **ตรงกันหมด** |
| `vuln` | govulncheck | **0 reachable** |
| i18n | extract + dictionary test | 18/18 · inventory ไม่เปลี่ยน |

---

## 10. ผลตรวจความปลอดภัย

ทำครบ 2026-11-19 ก่อนส่งมอบ ด้วยเครื่องมือ 4 ตัว: **SonarQube** (คุณภาพ+ความปลอดภัยของซอร์ส),
**Trivy** (CVE ใน container image + Dockerfile), **OWASP ZAP** (แอปที่กำลังรัน),
**govulncheck** (CVE ของ Go ที่ **โค้ดนี้เรียกถึงจริง**)

### 10.1 ส่งมอบอะไร

📄 **3 PDF ที่ `C:\Scans\REPORTS-FINAL\`** (ไม่อยู่ใน repo เพราะเป็นเอกสาร ไม่ใช่โค้ด)

| ไฟล์ | เครื่องมือ | หน้า | ผล |
|---|---|---|---|
| `1-ZAP-Running-Application.pdf` | OWASP ZAP 2.17.0 | 9 | **0 FAIL / 5 WARN / 63 PASS** |
| `2-Trivy-Container-Images.pdf` | Trivy 0.76.2 | 6 | image ที่ ship ทั้งสองตัว **0 high+critical** |
| `3-Govulncheck-Reachability.pdf` | govulncheck v1.9.0 | 5 | **0 reachable** |

ของ **SonarQube** ไม่ได้ทำเป็น PDF ในชุดนี้ (เจ้าของเลือก screenshot จาก UI แทน)
แต่มีรายงานหน้าเดียวสำหรับผู้บริหารที่ `C:\Scans\reports\sonar-report.html`
(เปิดแล้ว Ctrl+P → PDF) · **Quality Gate: PASSED**

เครื่องมือและสคริปต์ทั้งหมดอยู่ที่ **`C:\Scans\`** นอก repository และไม่ได้ commit:
`docker-compose.yml` (SonarQube Community + Postgres ของตัวเอง, **port 9001** เพราะ 9000 เป็นของ
backend), `scan.sh`, `trivy-scan.sh`, `zap-scan.sh`, `make-report.py` (Sonar),
`make-reports.py` (Trivy+govulncheck), `make-pdfs.mjs`, `README.md`

```bash
cd /c/Scans && docker compose -p sonar up -d    # บูตครั้งแรกหลายนาที (JVM + Elasticsearch ~4 GB)
bash prepare-reports.sh                         # coverage ของ Go + TS + Python, ESLint JSON
SONAR_TOKEN=sqa_... bash scan.sh                # ~6 นาที
cd /c/Scans && docker compose -p sonar stop     # ปิดเมื่อเสร็จ
```

> ⚠️ token ของ SonarQube ที่เคยใช้ **หมดอายุ 30 วัน** และใช้ได้กับ `localhost:9001`
> บนเครื่องเดิมเท่านั้น ทีมใหม่ต้องสร้างใหม่ใน My Account → Security
> และ **Global Analysis Token ส่ง analysis ได้ แต่เปลี่ยนสถานะ issue ไม่ได้**
> (ตอบ `Insufficient privileges`) อันหลังต้องใช้ **User Token**

### 10.2 ผลของ SonarQube

| | สแกนแรก | หลัง triage + แก้ |
|---|---|---|
| **Quality Gate** | NONE | ✅ **PASSED** |
| Security | D, 6 vulns | **B**, 2 |
| Reliability | D, 137 bugs | **C**, 131 |
| Maintainability | **A**, 135 smells | **A** |
| Duplication | **2.6%** | **2.6%** |
| Coverage | 31.2% | **46.5%** (be 49.1 · fe 43.5 · worker 46.4) |

New Code baseline ถูก pin ไว้ที่ analysis ของการส่งมอบ ฉะนั้น gate ถามว่า
**"สิ่งที่คุณเพิ่มหลังรับงานสะอาดไหม"** ซึ่งเป็นคำถามที่ถูกต้องสำหรับทีมใหม่
และเป็นเหตุผลที่มันอ่านว่า PASSED ทั้งที่ยังมี legacy bug 131 ข้อเปิดอยู่

> **เกรดตัวอักษรของ Sonar มาจาก finding ที่แย่ที่สุดที่เปิดอยู่** มันจึงอธิบายโค้ดที่
> **ship ไปแล้ว** ไม่ใช่โค้ดที่ทีมใหม่จะเขียน **อย่าไปไล่ปรับเกรด**

### 10.3 สิ่งที่เป็นปัญหาจริงและแก้แล้ว

| | |
|---|---|
| `nginx:1.27-alpine` | **EOL** → แช่อยู่ที่ Alpine 3.21.3 ตลอดกาล · **70 HIGH/CRITICAL** → เปลี่ยนเป็น `nginx:1.30-alpine` (Alpine 3.24.4) · **70 → 0** |
| pgx v5.6.0 | **SQL injection ที่โค้ดนี้เรียกถึงจริง** (GO-2026-5004, placeholder confusion กับ dollar-quoted literal ผ่าน `user.BulkDeleteUsers`) → v5.9.2 |
| `alpine:latest` | FROM บรรทัดเดียวที่ลอย → `alpine:3.24` |
| header ที่ขาด | `server_tokens off` + `Permissions-Policy` + COOP + CORP ใน `frontend/nginx/common.conf` |
| 7 advisory ที่เหลือ | ต้องยก `go` directive ใน `go.mod` เป็น **1.26.0** เพราะ `x/net` และ `x/crypto` ทุกเวอร์ชันที่มี fix ประกาศ `go 1.26.0` — ไม่มีทางเลือกที่เก็บ floor เดิมไว้ **เจ้าของอนุมัติ** |

**บทเรียนที่ควรจำ: Trivy ไม่พอ ต้องรัน govulncheck ด้วย**
Trivy อ่านว่ามีอะไน **อยู่ใน image** มันเรียก CVE ของ pgx ว่า "memory-safety vulnerability"
แล้วจบ ส่วน **govulncheck รายงานเฉพาะ advisory ที่โค้ดนี้เรียก symbol ที่มีช่องโหว่จริง**
และเรียกมันด้วยชื่อที่ถูกต้องคือ SQL injection — finding ที่ร้ายแรงที่สุดของทั้งรอบ
ซึ่งพาดหัวของ scanner ทั้งสองตัวไม่มีทางนำใครไปถึง
มันยังเจอ quic-go GO-2026-5676 ที่ Trivy มองไม่เห็นเลย และ **ปฏิเสธ** ที่จะ list
x/crypto CVE-2026-56854 อย่างถูกต้อง (อันนั้นเป็นฝั่ง server)

```bash
cd backend && go install golang.org/x/vuln/cmd/govulncheck@v1.9.0 && govulncheck ./...
```

เป็น CI job อยู่แล้ว (`vuln`, advisory-only) — **รันก่อนเชื่อรายการ CVE ของ Go ทุกครั้ง**

ตัวเลขก่อน/หลัง: Trivy frontend **70 → 0** HIGH/CRITICAL · backend **7 → 0** ·
**govulncheck 11 → 0** · ZAP **8 WARN / 60 PASS → 5 WARN / 63 PASS**

### 10.4 False positive — อย่าเสียเวลาเถียงใหม่

- **msgpack 1.1.2 · urllib3 2.7.0 · setuptools 70.3.0 ใน worker (5 HIGH)** — ทั้งสามเป็น
  **สำเนาที่ pip vendor มาเอง** (`pip/_vendor/vendor.txt` ระบุเวอร์ชันพวกนี้เป๊ะ) และ
  import ไม่ได้: `import urllib3` ใน container ที่รันอยู่ตอบ `ModuleNotFoundError`
  มันทำงานตอน `pip install` ตอน build แล้วไม่ทำงานอีกเลย · `pip list` ก็ไม่โชว์
- **x/crypto CVE-2026-56854** (ssh source-address auth bypass) — ฝั่ง server เท่านั้น
  โค้ดนี้ไม่มี `ssh.ServerConfig` มีแต่ `ssh.Dial`
- **ZAP 10096** Timestamp Disclosure — เป็นค่าคงที่ใน bundle ของ three.js
- **ZAP 10109 / 10049** — informational · response ที่ cacheable คือ asset ที่ชื่อเป็น hash
  และ `index.html` เป็น `expires -1` อยู่แล้ว
- **ZAP 10055** CSP `style-src 'unsafe-inline'` — จริง และเป็น trade-off ที่เขียนเหตุผลไว้ใน
  `common.conf` แล้ว (inline style attribute 1,161 จุด · STYLE ที่ถูก inject ก็ execute ไม่ได้)
- **Sonar `typescript:S2068`** ×3 "hard-coded password" — `"auto-generate"` เป็น **enum ของ
  FortiOS** สำหรับโหมดรหัส guest ที่ถูกจับเพราะชื่อ field ว่า `password`
- **Sonar `typescript:S2871`** ×4 ".sort() ไม่มี comparator" — ทั้งสี่จุด sort **string**
  ไม่ใช่ตัวเลข
- **Sonar `go:S1764`** — `got != got` คือวิธีเช็ก NaN มาตรฐาน และบรรทัดนั้นเขียน `// NaN check` ไว้แล้ว
- **Sonar `docker:S6470`** (`COPY . .`) — mark Accepted · ลดความเสี่ยงที่ build context แทน
  ซึ่ง Sonar มองไม่เห็น (การเขียน COPY ทีละไฟล์ถูกพิจารณาและปฏิเสธ: มันจะ**ตกโมดูลใหม่เงียบ ๆ**
  วันที่มีคนลืมเพิ่มบรรทัด)

### 10.5 สิ่งที่จงใจไม่แก้ และเพราะอะไร

1. **container ทั้งสามรันเป็น root** (Trivy DS-0002 = Sonar `docker:S6471`)
   เป็นปัญหาจริง แต่การย้ายไป non-root เปลี่ยนวิธี deploy และต้องทดสอบกับ stack ที่รันอยู่จริง
   — งานที่ต้องมีเวลาทดสอบของตัวเอง ไม่ใช่การแก้แถม
2. **worker: 118 จาก 119 Debian HIGH CVE ไม่มี fix ที่เผยแพร่แล้ว** ตัวที่ 119 (zlib1g)
   มี fix แต่ยังไม่เข้า `python:3.14-slim` ที่ publish อยู่ — ยืนยันด้วยการ pull base image มาดู
3. **CSP `style-src 'unsafe-inline'`** — ดูเหตุผลใน §10.4
4. **COEP ไม่เปิด** โดยตั้งใจ — มันให้แค่ SharedArrayBuffer isolation แล้วบล็อก subresource
   ทุกตัวที่ไม่มี CORP รวมถึงของที่หน้า topology 3D สร้างตอน runtime
5. **130 floating promise** — ดู [§12](#12-หนี้ทางเทคนิคที่เหลือไว้ตั้งใจ)

---

## 11. secret กับการเปิด repository เป็น public

> ⛔ **กฎที่ไม่มีข้อยกเว้น: `.env` ต้องไม่ถูก commit ไม่ว่ากรณีใด** — มันถือ `CRED_ENC_KEY`
> ซึ่งถอดรหัสผ่านไฟร์วอลล์ทุกตัวในฐานข้อมูลได้

### repository นี้สะอาด

repo นี้เริ่มจาก **commit เดียว** ที่เป็น snapshot ของโค้ดตอนส่งมอบ — **history ไม่มี secret อยู่เลย**
ตรวจได้ด้วย `git log -p | grep -i "JWT_SECRET\|PASSWORD\|API_KEY"` แล้วต้องเจอแต่ชื่อตัวแปร
ใน `.env.example` ซึ่งค่าว่างไว้ทั้งหมด

repository ชุดก่อนหน้า (ของเจ้าของเดิม เป็น private) **มี secret อยู่ใน history** เพราะ `.env`,
cookie jar และ session cookie ของไฟร์วอลล์เคยถูก track ก่อนที่ `.gitignore` จะครอบ
นั่นคือเหตุผลที่ repo นี้ถูกสร้างใหม่แทนที่จะ push ต่อ และเป็นเหตุผลที่
**SonarQube ถูก self-host ไม่ใช้ SonarCloud** ([§10](#10-ผลตรวจความปลอดภัย))

### จะเปิด public ได้ไหม

ทางเทคนิค **ได้** เพราะ history สะอาดแล้ว — แต่ตัดสินใจเองก่อนทำ อย่างน้อยควรดูสองอย่าง:

1. **เอกสารชุดนี้บอกรายละเอียดภายใน** — IP ของแล็บ, hostname, โครงสร้าง network, สิ่งที่จงใจ
   ยังไม่แก้ ([§12](#12-หนี้ทางเทคนิคที่เหลือไว้ตั้งใจ)) ถ้าจะเปิด public ควรย้ายของพวกนี้
   ออกไปอยู่ที่อื่นก่อน
2. **`AUDIT_CATALOGUE_STATUS`, ชื่อองค์กร, และ seed data** ใน `backend/config/db.go`
   — ตรวจว่าไม่มีอะไรของลูกค้าติดไปด้วย

### ของที่กันไว้ให้แล้ว

- **`.gitignore`** ครอบ `.env`, `frontend/certs/*.key`, `backend/geoip/*.mmdb`, cookie jar
- **`.gitleaks.toml` + CI job `secrets`** — fail ทันทีถ้า `.env` / `cookies.txt` / `fg.txt`
  ถูก track อีก หรือ gitleaks เจอ pattern ของ secret
- **ถ้าเผลอ commit secret ไปแล้ว** — `git rm --cached` ไม่พอ ต้อง **หมุนค่านั้นทันที**
  แล้วค่อยคิดเรื่องเขียน history ใหม่ ลำดับนี้สำคัญ: ค่าที่หลุดแล้วคือค่าที่หลุดแล้ว
---

## 12. หนี้ทางเทคนิคที่เหลือไว้ตั้งใจ

ทุกข้อในนี้ **รู้ตัว วัดแล้ว และตัดสินใจแล้วว่าไม่แก้ก่อนส่งมอบ** พร้อมเหตุผล
อย่าเพิ่งไปแก้ก่อนอ่านว่าทำไม — บางข้อการแก้แบบง่ายจะแย่กว่าตัวปัญหา

### 12.1 130 floating promise ใน 77 ไฟล์

SonarQube rule `typescript:S9383`

**รูปแบบ:** `DeviceSomething(id).then(...).finally(...)` โดย **ไม่มี `.catch()`**

**อาการ:** เมื่อไฟร์วอลล์ปฏิเสธหรือ timeout — ซึ่งเป็นเรื่องปกติที่นี่ — spinner หยุด
แล้วหน้าจอ**ไม่แสดงอะไรเลย** ซึ่งขัดกับกฎของโปรเจกต์เองว่า **"อ่านไม่ได้ ≠ ว่าง"**

**ทำไมไม่แก้:** เป็น refactor 77 ไฟล์ที่ **ไม่มีวิธีแก้แบบกลไก** — แต่ละจุดต้องตัดสินใจว่า
ผู้ใช้ควรเห็นอะไร

> ⛔ **ห้ามแก้ด้วย `.catch(() => {})` แบบเหมารวม** มันแย่กว่าตัวบั๊ก เพราะกลายเป็นการ
> กลืน error **โดยเจตนา** ซึ่งทำให้ปัญหาถูกซ่อนถาวรและหาไม่เจออีก

**วิธีที่ถูก มีอยู่ในโค้ดแล้ว:** `useDeviceData` กับ `{ strict: true }` + `DeviceStates`
ค่อย ๆ ย้ายทีละหน้า หน้าที่สำคัญที่สุดก่อน (หน้าที่แสดงว่าไฟร์วอลล์บังคับอะไรอยู่)

### 12.2 container ทั้งสามรันเป็น root

ดู [§10.5](#105-สิ่งที่จงใจไม่แก้-และเพราะอะไร) ข้อ 1

### 12.3 17 ESLint finding ที่เหลืออยู่ใน budget

ลดจาก 430 → 17 แล้ว (a11y 93→0, react-refresh 130→0, `no-explicit-any` 174→0,
`no-autofocus` 16→3) ที่เหลือแต่ละตัวต้องการการตัดสินใจเฉพาะหน้า ไม่ใช่การแก้แบบกลไก
**budget เป็น ratchet สองทาง** — แก้ได้ แต่ต้องลดตัวเลขใน `lint-budget.json` ใน commit เดียวกัน

### 12.4 ของที่ตัดสินใจแล้วว่า **จะไม่ทำ** — อย่า re-derive

| | เหตุผล |
|---|---|
| แยก `services/fortigate/` และ `services/audit/` ต่อ | ติดโครงสร้างไม่ใช่ติดแรง — 33 symbol เป็น **method บน `FortiClient`** และ 20 ตัวอยู่ใน interface `deviceClient` ที่ handler test ทุกตัวเอาไปแทน มันคือการ redesign และจะย้อนงาน Phase 6 |
| retrofit `VirtualList` เข้าตาราง policy / log / address | เปลี่ยน **พฤติกรรม** ของหน้า ไม่ใช่วิธีเขียน ควรอยู่ในงาน performance ที่มีตัวเลข before/after ของตัวเอง |
| แปลง dialog ลบให้เหลือแบบเดียว | **สองแบบคือ end state ที่ต้องการ** — `MascotDeleteModal` สำหรับ object ที่มีภาพมาสคอตวาดไว้ (6 หน้า), `ConfirmDeleteModal` สำหรับที่ไม่มี (9 หน้า) แปลงอีก 9 หน้าต้องวาดรูปใหม่ 9 รูป ซึ่งไม่มีใครขอ |
| rename `middleware/` ให้ตรงกับ `package middlewares` | เอกสารไว้ใน `backend/README.md` แทน |
| merge Dependabot PR 10 ตัวก่อนส่งมอบ | ปล่อยให้ทีมใหม่ตัดสินใจ · แนวทางอยู่ใน `.github/dependabot.yml` |
| Thai **comment** ในซอร์ส | **เก็บไว้โดยเจตนา** — ทีมที่รับงานอ่านไทย ส่วน **error string ที่ผู้ใช้เห็น** ถูกแปลเป็นอังกฤษแล้วครบ (ภาษาต้นทางของ UI คืออังกฤษ) |
| `entity` coverage 0% | เป็น struct definition — ควรเป็น 0% ต่อไป |

### 12.5 ผลยืนยันกับไฟร์วอลล์จริง รอบสุดท้ายก่อนส่งมอบ

การอัปเดต dependency รอบสุดท้าย (`c6a2d48` + `8f21aab` — pgx 5.9.2, x/net, x/crypto,
nginx 1.30-alpine, go.mod floor 1.26.0) แตะเส้นทางที่คุยกับอุปกรณ์โดยตรง จึงถูกทดสอบกับ
**FortiGate-80E ตัวจริง** (`10.10.20.90` · serial `FGT80ETK19026638` · v7.2.10 build 1706 ·
hostname `NGFW-Testing`) เมื่อ **2026-11-19 ช่วงค่ำ** ผ่าน VPN — **ผ่านครบทั้ง 8 ข้อ**

| # | ทดสอบ | ผล |
|---|---|---|
| 1 | REST เขียน + Change Ledger | ✅ create 201 → อ่านกลับ `10.99.88.0/24` ตรงทุก field → PATCH 200 → อ่านกลับ `10.99.77.0/24` ตรง → DELETE **ด้วย mkey** → หายจริง · ledger 604/605 ชื่อผู้ใช้ถูก `revertible:true` |
| 2 | SSH (`ssh.Dial` ใน x/crypto) | ✅ ping `64 bytes from 8.8.8.8` · traceroute hop 1 `10.10.20.1` · terminal เปิด `10.10.20.90:22` prompt `NGFW-Testing #` |
| 3 | WebSocket ผ่าน nginx 1.30 | ✅ เปิด 101 ทั้งสามเส้นจากเบราว์เซอร์จริง · ด้านลบ `Origin: evil.example.com` → **403**, `Origin: null` → **403** |
| 4 | worker backup | ✅ **32,665 บรรทัด** · View คืน config ที่ถอดรหัสแล้ว · Download 32,664 บรรทัด |
| 5 | `BulkDeleteUsers` (จุดที่ pgx SQL injection อยู่จริง) | ✅ สร้าง 2 → ลบเป็นชุด `{"count":2}` → เหลือ 0 |
| 6 | smoke suite ผ่านเบราว์เซอร์ | ✅ **55 passed / 0 failed** (1 skipped) |
| 7 | nginx security header | ✅ `Permissions-Policy` ไม่มี `microphone`/`clipboard-write` · `Server: nginx` ไม่มีเวอร์ชัน · COOP + CORP ครบ |
| 8 | หน้าที่อ่านหนัก | ✅ firewall-policies · audit (34 KB) · policy-stats · drift · interfaces · ipsec (`[]` ไม่มี tunnel) |

ของทดสอบถูกลบครบ (address ด้วย mkey, user 2 คน, backup ที่สร้างระหว่างเทส) และ
`frontend/e2e/.auth/state.json` ซึ่ง playwright ทิ้ง **session cookie ไว้ในโฟลเดอร์โปรเจกต์**
ถูกลบด้วย — ไฟล์นี้ถูก git-ignore แล้ว แต่ให้ลบทุกครั้งหลังรัน smoke

> ⚠️ **สองกับดักที่เจอระหว่างทดสอบ จดไว้เพื่อไม่ให้เสียเวลาซ้ำ**
>
> 1. **WebSocket ที่เปิดไม่ขึ้น = rate limit จนกว่า log จะบอกเป็นอย่างอื่น** รอบแรก WS ตายทั้งสาม
>    เส้นโดยไม่มี frame เลย ดู log แล้วเป็น **429** เพราะ smoke suite เพิ่งใช้ `DiagLimiter`
>    (10/นาที) และ `GeneralLimiter` (120/นาที) จาก IP เดียวกันจนหมด
>    `docker compose restart backend` ล้าง limiter ที่อยู่ใน memory ทันที แล้วเปิดได้ทั้งสามเส้น
> 2. **อย่าเดารหัส admin ด้วยการ login ซ้ำ ๆ** อ่าน bcrypt hash จาก Postgres แล้วเทียบ offline แทน
>    (โมดูล `bcrypt` มีอยู่แล้วใน container ของ worker เพราะ paramiko ลากมา):
>    ```bash
>    HASH=$(docker compose exec -T postgres psql -U postgres -d starter_web -tA -c "SELECT password FROM app_users WHERE id=1;")
>    docker compose exec -T -e H="$HASH" worker python -c "import os,bcrypt;print(bcrypt.checkpw(b'<รหัสที่จะลอง>', os.environ['H'].encode()))"
>    ```

**→ สิ่งแรกที่ทีมใหม่ควรทำหลังตั้งไฟร์วอลล์ของตัวเองได้:** รันรายการเดียวกันนี้กับเครื่องของคุณ
(`/fg-verify` หรือ checklist ใน `references/verify-live.md`) แล้วลบ test object ด้วย mkey
และ **รันซ้ำทุกครั้งหลัง bump base image หรือ x/crypto** ไม่ใช่ก่อนหน้านั้น

⚠️ `npx playwright install chromium` ต้องรันหนึ่งครั้งบนเครื่องใหม่ — `@playwright/test` เป็น
dependency อยู่แล้วแต่ตัว browser ไม่ได้มากับมัน และสคริปต์ที่ `import "@playwright/test"`
ต้องรันจากใน `frontend/` ไม่งั้น resolve ไม่เจอ

---

## 13. งานที่เจ้าของเดิมต้องทำเอง

งานพวกนี้ **ทำแทนไม่ได้** เพราะต้องเข้าบัญชีของเจ้าของ

### 13.1 🔴 หมุน `ANTHROPIC_API_KEY` และลบตัวเก่า

**repository นี้ไม่มีกุญแจอยู่ใน history** (`.env` ไม่เคยถูก commit ที่นี่ และ `.env.example`
เว้นค่าว่าง) แต่กุญแจเดิมของเจ้าของ **เคยอยู่ใน history ของ repository ชุดก่อน** และยังใช้งานได้
เจ้าของเดิมระบุเมื่อ 2026-11-19 ว่าเป็น test key และเลือกไม่เปลี่ยน — เป็นการตัดสินใจ ไม่ใช่
การมองข้าม

**สิ่งที่ทีมใหม่ควรทำคือออกกุญแจของบัญชีตัวเอง ไม่ใช่ใช้ของเจ้าของเดิมต่อ**

วิธีทำ:

1. สร้างกุญแจใหม่ที่ <https://console.anthropic.com/settings/keys>
2. **ลบกุญแจเก่า** — สร้างใหม่ไม่ได้ปิดการใช้งานตัวเก่า ต้องกดลบ
3. ใส่ค่าใหม่ใน `.env` → `docker compose up -d --build backend`

> ทีมใหม่: อย่า reuse กุญแจของเจ้าของเดิม ออกกุญแจใหม่ในบัญชีขององค์กรคุณ แล้วตั้งใน `.env`
> ของคุณเอง · ถ้าปล่อยว่าง ระบบยังบูตปกติ แค่หน้า Wizard Config ตอบ "not configured"

### 13.2 เพิกถอน Gmail app password

ถ้าใช้ email OTP / ส่งรายงาน: ลบ app password ที่ <https://myaccount.google.com/apppasswords>
สร้างใหม่ ใส่ใน `.env` (`SEED_SMTP_*` หรือตั้งจากหน้า Services หลังระบบขึ้น) แล้ว rebuild
และส่งทดสอบจาก Notify

### 13.3 ตั้ง `SEED_ADMIN_PASSWORD` ก่อนบูตครั้งแรกของ deployment ใหม่

ตั้งทีหลังไม่มีผล seed ข้ามตารางที่มีแถวแล้ว ([§4.4](#44-บัญชีที่-seed-มา-และ-role))

### 13.4 เพิกถอน token ของ SonarQube ที่เครื่องเดิม

My Account → Security ของ SonarQube ที่ `localhost:9001` — token ที่เคยใช้หมดอายุใน 30 วัน
และใช้ได้บนเครื่องเดิมเท่านั้น แต่เพิกถอนให้เรียบร้อยดีกว่าปล่อยค้าง

### 13.5 ส่งต่อสิ่งที่ไม่อยู่ใน repo

| | อยู่ที่ |
|---|---|
| `.env` ของ production (ถ้ามี) | เครื่องที่ deploy — **ส่งผ่านช่องทางที่ปลอดภัย ไม่ใช่ chat/email** |
| **`CRED_ENC_KEY` ที่ใช้งานอยู่** | หายแล้วรหัสผ่านอุปกรณ์ทุกตัวอ่านไม่ได้อีก — **สำคัญที่สุด** |
| รหัส admin ของคอนโซล | — |
| 3 PDF ผลตรวจ | `C:\Scans\REPORTS-FINAL\` |
| เครื่องมือสแกน | `C:\Scans\` |
| ความเป็นเจ้าของ repo / organisation บน GitHub | — |
| ข้อมูลเครื่องแล็บ: IP, บัญชี admin ของ FortiGate | — |

---

## 14. การดูแลประจำ

### 14.1 คำสั่งที่ใช้บ่อย

```bash
docker compose up -d --build backend     # rebuild หลังแก้ Go
docker compose up -d --build frontend    # rebuild หลังแก้ React (หรือหลังสร้าง cert ใหม่)
docker compose ps                        # healthy ครบไหม
docker compose logs -f backend
docker compose restart worker
docker compose stop                      # ปิดโดยเก็บทุกอย่างไว้
```

### 14.2 สำรองและกู้คืน

**สำรองอะไร** (สามอย่าง และต้องครบทั้งสาม):

1. **Postgres** — `docker compose exec postgres pg_dump -U postgres starter_web > dump.sql`
2. **`CRED_ENC_KEY` ทุกเวอร์ชันที่ยังใช้งาน** — เก็บ **แยกจาก** dump ของฐานข้อมูล
   (ไม่มีกุญแจ dump ก็ไม่มีประโยชน์ มีทั้งคู่ในที่เดียวก็ไม่มีประโยชน์ในแง่ความปลอดภัย)
3. **volume `project_config-backups`** — git repo ที่เก็บ config ย้อนหลังของไฟร์วอลล์

**config ของไฟร์วอลล์เอง** ถูก backup โดย worker ตามตารางที่ตั้งในหน้า Devices
เก็บ 365 วัน / 60 ไฟล์ต่อเครื่อง และ **rollback ใช้ `monitor/system/config/restore`
คือคืนไฟล์ทั้งไฟล์** ไม่ใช่การ replay CLI ทีละบรรทัด (ดู [§8.6](#86-กับดักของตัวแอป))

### 14.3 หมุน `CRED_ENC_KEY`

```
1. เพิ่ม CRED_ENC_KEY_V<N+1> ใน .env  **และ** pass through ใน docker-compose.yml
   แล้วตั้ง CRED_ENC_KEY_VERSION=<N+1>  —  เก็บกุญแจเดิมไว้ มันคือสิ่งเดียวที่ยังอ่าน
   แถวที่เขียนก่อนหมุนได้  →  restart backend
2. POST /admin/rotate-cred-key  (admin only) — re-encrypt ทั้ง 3 ตาราง
3. เช็ก object `tables` ใน response: **ทุกตาราง** ต้อง failed=0 และ rotated+skipped=total
4. แล้วจึงลบกุญแจเดิมออกจาก .env และ docker-compose.yml
```

> ⚠️ ลบกุญแจเดิมตอนที่ยังมีตารางถือแถวเวอร์ชันเก่าอยู่ = แถวนั้นอ่านไม่ได้ตลอดไป **โดยไม่มี error**
> กุญแจทุกเวอร์ชันที่ยังใช้งานต้องถูก pass through ใน `docker-compose.yml` ด้วย —
> กุญแจที่อยู่ใน `.env` แต่ไม่ได้ pass เข้าไปจะ**ไม่มีอยู่**ใน container และการหมุนจะ fail
> ทุกแถวที่มันคุ้มครอง

มีสคริปต์ช่วย generate บน Windows: `scripts/rotate-cred-key.ps1`

### 14.4 สิ่งที่ scheduler ทำทุก 60 วินาที

backup ตามตาราง · ล้าง job ที่ค้างเกิน 5 นาที (→ FAILED) · alert sweep ของ Notify ·
เก็บ metric sample (ทุก 5 นาที) · retention sweep (ทุกชั่วโมง)
panic ใน tick หนึ่งถูก log พร้อม stack และ **ไม่ล้มลูป** — เสียแค่ tick นั้น

### 14.5 อาการที่เจอบ่อย

| อาการ | สาเหตุที่น่าสงสัยก่อน |
|---|---|
| stack ค้างตอนบูต ไม่ขึ้นเลย | เปลี่ยน `REDIS_PASSWORD` แล้วลืมแก้ healthcheck → Redis ตอบ NOAUTH → ไม่ healthy → backend+worker รอตลอดไป |
| compose ไม่สร้าง container เลย พร้อม error 4 บรรทัด | `.env` ไม่มีค่าลับ → `${VAR:?}` guard ([§4.3](#43-ทำไมต้องใช้-bootstrap-ไม่ใช่คัดลอก-env-ตัวอย่าง)) |
| backend ตายตอนบูตพร้อม `[FATAL]` | `ValidateCredKeyConfig` / `ValidateWorkerSecret` — ค่าหาย สั้นเกิน หรือเป็น placeholder |
| clone ที่สองฟ้อง "Pool overlaps" | `project_appnet` ของ stack จริงยังอยู่ — `docker compose down` (**ไม่ใส่ `-v`**) ลบ network โดยเก็บ volume |
| Devices บอกว่า worker offline | heartbeat key ใน Redis หมดอายุ — ดู `docker compose logs worker` |
| หน้าว่างเปล่าไม่มี error | น่าจะเป็น floating promise ([§12.1](#121-130-floating-promise-ใน-77-ไฟล์)) |
| อุปกรณ์ที่ดีรายงานว่า unreachable | circuit breaker เปิดเพราะรหัสผิดของ credential อีกใบ — pool key แยกตาม credential แล้ว แต่เช็กว่าใครใส่รหัสผิดไว้ |

---

## 15. ภาคผนวก

### 15.1 หาโค้ดเร็ว ๆ — จากหน้าจอไปถึง FortiOS

ยกตัวอย่าง "อยากแก้หน้า Static Routes":

```
sidebar                frontend/src/components/structure/sidebar/data.tsx   { name: "static-routes" }
  → route              frontend/src/routes/mainroutes.tsx                   { path: "static-routes" }
  → page               frontend/src/pages/static-routes/
  → api                frontend/src/api/policyObject.ts                     DeviceListStaticRoutes
  → endpoint           backend/routes/routes_device_system.go               /policy/device/:deviceId/static-routes
  → controller         backend/controller/policyobject/device_route.go      DeviceListStaticRoutes
  → client             backend/services/fortigate_route.go                  (*FortiClient).GetStaticRoutes
  → FortiOS            GET /api/v2/cmdb/router/static?vdom=root
```

ไล่ย้อนจากปลายทางก็ได้: `grep -rn "router/static" backend/`


### 15.2 คำศัพท์ FortiOS ที่ต้องรู้

| คำ | หมายถึง |
|---|---|
| **CMDB** | configuration database ของ FortiOS — `/api/v2/cmdb/...` คือ config ที่เขียนได้ |
| **monitor API** | `/api/v2/monitor/...` — สถานะ runtime อ่านอย่างเดียว คนละชุดกับ CMDB |
| **mkey** | primary key ของแถวในตาราง CMDB (ชื่อ object, policy id, seq-num) · **ลบต้องมี mkey** |
| **vdom** | virtual domain — ไฟร์วอลล์เสมือนในเครื่องเดียว · โปรเจกต์นี้ default `root` |
| **policy first-match** | FortiGate ไล่ policy จากบนลงล่าง **ตัวแรกที่ตรงชนะ** → ลำดับคือความหมาย |
| **shadowed rule** | rule ที่มี rule ด้านบนครอบไว้หมด จนไม่มีทางถูกใช้ |
| **UTM / security profile** | ชุดการตรวจ (AV, web filter, IPS, …) ที่ผูกเข้ากับ policy |
| **VIP** | virtual IP = DNAT (port forward) · **IP pool** = SNAT |
| **flow-based / proxy-based** | โหมดการตรวจ — เครื่อง flow-based รับ field ของ proxy แล้วทิ้งเงียบ ๆ |
| **phase1 / phase2** | สองชั้นของการเจรจา IPsec (`vpn.ipsec/phase1-interface`, `phase2-interface`) |
| **ADVPN** | Auto-Discovery VPN — spoke คุยกันตรงได้ · template hub-and-spoke ใช้คู่กับ BGP |
| **performance SLA** | การวัด latency/loss/jitter ของ SD-WAN member เพื่อตัดสินใจเลือกเส้น |
| **accprofile** | profile สิทธิ์ของ administrator บนตัวไฟร์วอลล์ |
| **TOFU** | trust on first use — จำ host key/certificate ครั้งแรกแล้วเตือนถ้าเปลี่ยน |

### 15.3 พอร์ตที่ใช้

| พอร์ต | อะไร |
|---|---|
| 5173 | frontend (dev: vite · prod: nginx HTTP → redirect ไป HTTPS ถ้ามี cert) |
| 5443 | frontend HTTPS (ต้องมี cert ใน `frontend/certs/`) |
| 4173 | `vite preview` |
| 9000 | backend Go |
| 5432 | Postgres — **ไม่ publish** |
| 6379 | Redis — **ไม่ publish** |
| 9001 | SonarQube (เครื่องมือภายนอก repo ที่ `C:\Scans`) |

### 15.4 ที่มาเดียวที่เชื่อถือได้ของแต่ละเรื่อง

ของพวกนี้ **อ่านจากไฟล์ อย่าอ่านจากเอกสาร** เพราะเอกสารเคยผิดมาแล้วทุกตัว:

| อยากรู้ | อ่านจาก |
|---|---|
| มี endpoint อะไร | `backend/routes/routes.go` + `routes_*.go` |
| มีหน้าอะไร | `frontend/src/components/structure/sidebar/data.tsx` |
| ไฟล์ไหนอยู่ใน layout budget | `backend/test/layout-budget.json` และ `-bytes.json` |
| เหลือ lint finding เท่าไร | `frontend/lint-budget.json` |
| coverage floor เท่าไร | `backend/test/coverage-budget.json` |
| CI ทำอะไร | `.github/workflows/ci.yml` |
| `.env` ต้องมีอะไร | `.env.example` (มีคำอธิบายทุก key ว่า REQUIRED หรือ OPTIONAL) |
| `diagnose` อะไรที่ยิงผ่านคอนโซลได้ | `allowedDiagnosePatterns` ใน `backend/controller/configdeploy/configdeploy.go` |
| จำนวนเทสต์ / finding | **รัน `/fg-preflight` แล้วอ่านตัวเลขสด** |

---

<p align="center"><sub>
เอกสารนี้เขียนเป็นภาษาไทยโดยเจตนา — ทีมที่รับงานอ่านไทย · ข้อความที่ผู้ใช้เห็นในแอปเป็นภาษาอังกฤษ
ซึ่งเป็นภาษาต้นทาง และแปลเป็น TH/ZH ตอน render
</sub></p>
