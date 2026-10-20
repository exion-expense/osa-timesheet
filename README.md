# OSA Contractor Timesheet

ระบบลงเวลาเข้า-ออกงานผู้รับเหมา อนุมัติ 2 ชั้น และคิดค่าแรงอัตโนมัติ สำหรับ OSA Valve Services (Thailand)

- **ผู้รับเหมา** สแกน QR ที่หน้างาน → เลือกชื่อ → ใส่ PIN 4 หลักประจำวัน → เช็คอิน / เช็คเอาท์ (ไม่ต้องติดตั้งแอป ไม่ต้องล็อกอิน)
- **แอดมิน** สร้างจ็อบ เลขจ็อบ ช่วงวันที่ ทีม หัวหน้างาน และรายชื่อลูกทีม
- **หัวหน้างาน** แจก QR, สร้าง PIN ประจำวัน, เพิ่ม/ลบ/ย้ายคนในทีม, แก้เวลา (ต้องใส่เหตุผล), อนุมัติใบลงเวลารายวัน, อนุมัติใบคิดราคา
- **Planner** ตรวจและอนุมัติใบลงเวลารายวัน (ชั้นที่ 2), ใส่ Allowance รายคน
- **Purchase** ใส่ค่าแรงต่อวัน เลือกและ**ยืนยัน**เงื่อนไข 5/6 วัน และพัก/ไม่พักก่อน OT → ระบบคำนวณ → ส่งหัวหน้างานอนุมัติ
- ทุกทีมต้องมีหัวหน้างาน (คนเดียวที่อนุมัติใบลงเวลาของทีมนั้นได้)
- เอกสารพิมพ์: รายชื่อทีมงานรายวัน, Time Sheet, สรุปค่าแรง (หัก ณ ที่จ่าย 3%), ป้าย QR

## สูตรคำนวณ

| รายการ | วิธีคิด |
|---|---|
| ชั่วโมงทำงาน | เวลาออก − เวลาเข้า − ช่วงพักเที่ยงที่คร่อม (12:00–13:00) |
| ปกติ | ไม่เกิน 8 ชม.แรก |
| OT | ส่วนที่เกิน 8 ชม. − พักเย็น 30 นาที (ถ้าจ็อบเลือก "พัก") |
| การปัด | ปัดลงทีละ 30 นาที เผื่อ 5 นาที (เช่น 7:57 → 8, OT 2:50 → 2.5) |
| เรทต่อชั่วโมง | ค่าแรงต่อวัน ÷ 8 |
| ตัวคูณ | ปกติ ×1 · OT ×1.5 · วันหยุด ×2 · OT วันหยุด ×3 |
| วันหยุด | 6 วัน = อาทิตย์ · 5 วัน = เสาร์-อาทิตย์ · + วันหยุดในหน้า "ตั้งค่า" |

ค่าเหล่านี้เปลี่ยนได้ที่หน้า **ตั้งค่า** (แอดมิน) — ใบคิดราคาที่ส่งแล้วจะไม่เปลี่ยนตาม

---

## ติดตั้งครั้งแรก

### 1) Supabase

1. สร้าง Project ใหม่ (Region: **Southeast Asia (Singapore)**) ตั้งรหัสผ่านฐานข้อมูลที่แข็งแรงและเก็บไว้ที่ปลอดภัย (ไม่ต้องใส่ในโปรเจกต์นี้)
2. **SQL Editor** → New query → วางไฟล์ `supabase/migrations/0001_init.sql` ทั้งไฟล์ → Run
3. ทำซ้ำกับ `supabase/migrations/0002_holidays.sql` และ `supabase/migrations/0003_terms_and_supervisor.sql` (ตามลำดับ)
4. **Authentication → Sign In / Providers**: ปิด **Allow new users to sign up** (เพิ่มผู้ใช้โดยแอดมินเท่านั้น)
5. **Authentication → Policies / Password**: ตั้งความยาวรหัสผ่านขั้นต่ำ 10 ตัว และบังคับให้มีตัวเลข/ตัวพิมพ์ใหญ่/สัญลักษณ์
6. **Authentication → Multi-Factor**: ตรวจว่า **TOTP เปิดอยู่** (ค่าเริ่มต้นเปิด)
7. **Authentication → URL Configuration**: Site URL = ที่อยู่เว็บ เช่น `https://<github-user>.github.io/osa-timesheet/`
8. **Advisors → Security Advisor**: กด Refresh แล้วตรวจว่าไม่มี error สีแดง

### 2) สร้างแอดมินคนแรก

1. **Authentication → Users → Add user → Create new user** ใส่อีเมลของคุณ ตั้งรหัสผ่าน (อย่างน้อย 10 ตัว) และติ๊ก **Auto Confirm User**
2. SQL Editor รัน (แก้อีเมลและชื่อ):

```sql
update public.profiles set role = 'admin', full_name = 'ชื่อของคุณ' where email = 'you@company.com';
```

3. (ตัวเลือก) ปิดรหัส 2 ชั้น ถ้าต้องการใช้รหัสผ่านอย่างเดียว: `update public.app_settings set require_mfa = false where id = 1;`
   — ถ้าเปิดไว้ (ค่าเริ่มต้น) แอดมินและ Purchase ต้องสแกน QR ด้วย Google/Microsoft Authenticator ตอนเข้าครั้งแรก
4. คนต่อไป: Add user แบบเดียวกันด้วยรหัสชั่วคราว → กำหนดตำแหน่งในหน้า **ผู้ใช้งาน** ของเว็บ → ผู้ใช้กดไอคอนกุญแจ (ล่างซ้าย) เพื่อเปลี่ยนรหัสผ่านเอง
5. ลืมรหัสผ่าน: แอดมินตั้งรหัสใหม่ให้ที่ Authentication → Users → เลือกผู้ใช้ → Reset password / Update user

### 3) GitHub Pages

1. สร้าง repo ชื่อ `osa-timesheet` แล้ว push โฟลเดอร์นี้ขึ้นไป (branch `main`)
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. **Settings → Secrets and variables → Actions → Variables** เพิ่ม 2 ตัว (ค่าจาก Supabase → Project Settings → API Keys):
   - `VITE_SUPABASE_URL` = `https://xxxx.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = anon key หรือ publishable key (`sb_publishable_...`)
4. Push อีกครั้ง (หรือ Actions → Deploy to GitHub Pages → Run workflow) → ได้เว็บที่ `https://<github-user>.github.io/osa-timesheet/`

> anon / publishable key **เปิดเผยได้** (ออกแบบมาให้อยู่ในหน้าเว็บ ข้อมูลถูกป้องกันด้วย RLS)
> แต่ **service_role / secret key ห้ามอยู่ในโปรเจกต์นี้เด็ดขาด** — `npm run check:secrets` และ GitHub Actions จะตรวจให้ทุกครั้ง

### ข้อควรรู้เรื่อง Supabase ฟรี

- ถ้าไม่มีใครใช้งาน 7 วัน project จะถูก **pause** → เข้า Dashboard กด Restore ได้ (ข้อมูลไม่หาย)
- แพลนฟรีไม่มีระบบสำรองข้อมูลให้ดาวน์โหลด แนะนำ Export ตารางเป็น CSV เดือนละครั้ง (Table Editor → Export) หรืออัปเกรดเมื่อใช้งานจริงจัง

---

## พัฒนาบนเครื่อง

```bash
npm install
cp .env.example .env.local   # ใส่ URL + anon key ของ project ทดสอบ
npm run dev
```

- `npm test` — ทดสอบฟังก์ชันจัดรูปแบบวันที่/จำนวนเงิน
- `npm run check:secrets` — ตรวจว่าไม่มีคีย์ลับหรือไฟล์ข้อมูลส่วนบุคคลก่อน push
- `supabase/tests/test.sql` — ชุดทดสอบฐานข้อมูล 72 ข้อ (สูตรชั่วโมง, สิทธิ์, PIN, อนุมัติ, ยอดเงิน) รันบนฐานข้อมูลทดสอบที่โหลด `supabase/local/stub.sql` ก่อนเท่านั้น **ห้ามรันบน Supabase จริง**

## โครงสร้าง

```
supabase/migrations/   SQL สำหรับ Supabase (ตาราง, RLS, ฟังก์ชัน)
src/pages/             หน้าจอ (Kiosk = หน้าลงเวลาผู้รับเหมา)
src/print/             เอกสารพิมพ์ A4
.github/workflows/     deploy อัตโนมัติไป GitHub Pages
```

ดูรายละเอียดความปลอดภัยและ PDPA ที่ [SECURITY.md](SECURITY.md)
