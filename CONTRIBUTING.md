# Network-Automation

โปรเจกต์นี้คือ **FortiGate / FortiOS firewall automation platform** (Go + React + Python worker)
โค้ดทั้งหมดอยู่ที่ root ของ repo นี้ (`backend/`, `frontend/`, `worker/`) — vendor เดียวคือ **Fortinet**

## 👉 อ่านก่อนเริ่มงานทุกครั้ง

**[HANDOVER.md](HANDOVER.md)** — เอกสารส่งมอบฉบับเต็ม: สถาปัตยกรรม, ติดตั้งจากศูนย์,
กฎการเพิ่มฟีเจอร์, quality gate ทุกตัว, กับดักที่ต้องรู้, ผลตรวจความปลอดภัย, หนี้ที่เหลือไว้
· [README.md](README.md) สำหรับภาพรวมและแผนที่ฟีเจอร์ · [backend/README.md](backend/README.md)
สำหรับว่าโฟลเดอร์ Go ไหนทำอะไร

ไฟล์นี้คือกฎย่อที่ห้ามลืม อ่านได้ใน 2 นาที — เหตุผลเต็มของทุกข้ออยู่ใน `HANDOVER.md`

## กฎ 8 ข้อ

1. **ควบคุม firewall จริง** (แล็บ `10.10.20.90` FortiGate-80E, device id 1) — ต้องทดสอบกับเครื่องจริง
   ก่อนบอกว่าเสร็จ · `10.0.99.254` "Firewall-Real" **อ่านอย่างเดียว** ห้ามเขียนโดยไม่ถามก่อน
2. **อย่าเดา FortiOS schema** — ยืนยันจาก `?action=schema&vdom=root` หรือ SSH ก่อนเขียนโค้ด
   แล้ว **เขียนจริง 1 ครั้ง อ่านกลับมาเทียบ** — schema บอกแค่ว่าชื่อสะกดยังไง ไม่ได้บอกว่า
   เฟิร์มแวร์นี้รองรับ (`firewall/vip` → `status` ตอบ 200 แล้วทิ้งค่าเงียบ ๆ)
3. **ห้าม DELETE ที่ CMDB collection URL** — ตอบ 200 แล้วลบทั้งตาราง กู้ไม่ได้
   (เคยลบ policy หายทั้งเครื่องมาแล้ว) ลบต้องระบุ mkey เสมอ
4. **Reuse before create** — ชื่อซ้ำบน FortiGate = `error -5` · และเทียบรหัส error **ด้วยตัวเลข**
   (`errors.As` + `DeviceError{Code}`) ไม่ใช่ substring — `Contains(e,"-5")` จับ `-50..-59` และ `-518` ด้วย
5. **ฟีเจอร์ใหม่ = full-stack 6 ชั้น**: `services/fortigate_<domain>.go` (ไม่ใช่ `fortigate.go`) →
   controller → `routes_*.go` → `api/` → page → sidebar → i18n → test
6. **device handler ทุกตัวเริ่มที่ `getDeviceInfo()` + `buildClient()`** — permission, credential,
   session pool, cancellation อยู่ที่นั่นที่เดียว ห้ามเขียนเอง ห้าม `Logout` client จาก pool
7. **อ่านไม่ได้ ≠ ว่าง** — ฝั่ง FE ใช้ `{ strict: true }` + `useDeviceData` เสมอ
   และฟอร์มแก้ไขที่อ่านค่าเดิมไม่ได้ **ต้องไม่ render ฟอร์ม**
8. **Gate ต้องเขียว**: `go build/vet/test` + `gofmt -l .` ว่าง · `npm run test/build/lint:budget`
   · layout budget (ratchet สองทาง) · i18n extract + commit `i18n-strings.json`

## คำสั่งที่ใช้บ่อย

```bash
./scripts/bootstrap.sh                 # สร้าง .env ครั้งแรก (ห้าม cp .env.example .env)
docker compose up -d --build           # ขึ้นทั้ง stack
docker compose up -d --build backend   # rebuild หลังแก้ Go
cd frontend && npm run dev             # :5173
```

Login: `admin@got.co.th` (บัญชีเดียวที่ seed มา) — รหัสจาก `SEED_ADMIN_PASSWORD` ใน `.env`
ไม่ตั้ง = ค่า default ที่ฝังใน `backend/config/db.go` (public — log ตอนบูตเตือนให้เปลี่ยน)
DB ที่ seed ไปแล้วคงรหัสเดิมจนกว่าจะสร้าง DB ใหม่

## ที่มาเดียวที่เชื่อถือได้

> ฟีเจอร์จริงดูจาก `backend/routes/routes.go` (+ `routes_*.go` 5 ไฟล์) และ
> `frontend/src/components/structure/sidebar/data.tsx` **เท่านั้น** ไม่ใช่จากเอกสาร
> — จำนวนเทสต์ / lint finding / ไฟล์ใน budget ให้รันแล้วอ่านตัวเลขสด อย่าลอกจากที่ไหน
