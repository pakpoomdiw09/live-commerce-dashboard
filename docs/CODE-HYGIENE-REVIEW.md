# การจัดระเบียบโค้ดและไฟล์ในโปรเจกต์

ตรวจเมื่อ 23 ตุลาคม 2026 โดยคงโครงสร้าง App Router และการแก้ไขที่มีอยู่ก่อนรอบนี้ไว้

## มาตรฐานรูปแบบโค้ด

เพิ่ม Prettier เป็น dev dependency แบบระบุเวอร์ชัน พร้อม `.prettierrc.json`, `.prettierignore` และ `.editorconfig`

- ใช้ spaces 2 ช่อง ไม่มี tab
- ใช้ single quote ใน JavaScript/TypeScript และไม่เติม semicolon ที่ไม่จำเป็น
- จัดบรรทัดที่ความกว้างเป้าหมาย 100 ตัวอักษร และ trailing comma ในตำแหน่งที่รองรับ
- ใช้ UTF-8 และ LF; ไม่เปลี่ยนข้อความภาษาไทยหรือแปลข้อความใน UI
- จัดรูปแบบ source, tests, fixtures และ root config โดยไม่ย้ายไฟล์หรือเปลี่ยนตรรกะ ปรับ relative import 3 จุดเป็น `@/` ให้ผ่านกติกา architecture เดิม และย้าย lint suppression ของ `<img>` ให้ตรงบรรทัดหลัง formatter จัด JSX
- SQL ยังคงรูปแบบเดิม เพราะ Prettier มาตรฐานไม่มี PostgreSQL formatter อย่าใช้การแทนที่ whitespace แบบเหมารวมกับ SQL/string literals

```sh
npm run format
npm run format:check
npm run lint
```

ใน PowerShell ที่จำกัดการรัน `.ps1` ใช้ `npm.cmd` แทน `npm` ได้ ควรตรวจ `format:check` และ lint ก่อน merge ส่วนการตั้ง format on save ให้ใช้ Prettier ของโปรเจกต์เพื่อให้ตรงกับ CLI

## ไฟล์ที่แนะนำให้พิจารณาลบ

ขนาดเป็นค่าที่ตรวจพบในเครื่องรอบนี้ ไม่ใช่ขนาดที่ทุก checkout จะมี รายการนี้เป็นคำแนะนำ ยังไม่ได้ลบไฟล์หรือแก้ Git index

| ตำแหน่ง | หลักฐาน/เงื่อนไข | แนวทาง |
| --- | --- | --- |
| `.tmp/` | พบ 1,252 ไฟล์ รวมประมาณ 885 MiB ก่อนเริ่มจัดรูปแบบ มี build logs, screenshots, fixtures ที่สร้างขึ้น และสคริปต์ทดลอง | ลบเฉพาะผลลัพธ์ที่สร้างใหม่ได้หลังหยุด dev/build/browser processes และตรวจว่าไม่มีงานที่ยังต้องใช้ ควรเก็บไฟล์ทดลองที่ยังต้องการไว้ก่อน |
| `.npm-audit-cache/` | พบ 13 ไฟล์ ประมาณ 11.4 MiB เป็น npm cache/logs และทั้ง 13 ไฟล์ถูกติดตามใน Git | สร้างใหม่ได้ ควรเอาออกจาก Git ใน cleanup commit; เพิ่ม ignore แล้ว แต่ `.gitignore` ไม่หยุดติดตามไฟล์ที่มีอยู่ใน Git |
| `.next/`, `.next-dev/`, `tsconfig.tsbuildinfo` | build/dev/incremental output | ลบเพื่อสร้างใหม่ได้หลังหยุด process; ไม่ใช่ source code |
| `.continue/agents/new-config.yaml` | ไฟล์ tracked ขนาด 0 bytes | แนะนำลบถ้าไม่ได้ตั้งใจใช้ Continue config นี้ |
| `.continue/rules/new-rule.md` | เนื้อหา template `Your rule content` | ลบหรือแทนด้วยกติกาจริงเมื่อยังใช้งาน Continue |
| `.continue/prompts/new-prompt.md` | template prompt สำหรับเขียน tests | ลบได้ถ้าไม่ได้เรียกใช้จาก Continue; ไม่ใช่ไฟล์ runtime ของ Next.js |
| `.vscode/settings.json` | มี Python unittest settings ชี้ `./app` ในโปรเจกต์ Next.js | พิจารณาตัดค่า Python ถ้าไม่มี workflow นี้ แต่รักษาค่าของผู้พัฒนาที่ใช้งานอยู่ |
| `supabase/test-grant-ai-pro-diw.sql` | SQL ทดสอบสิทธิ์ที่เจาะจง tenant และมีการเขียนข้อมูล | ทบทวนว่าจะเก็บในพื้นที่ QA/archive หรือไม่ ห้ามรันเพื่อ cleanup และอย่าลบจากชื่อ `test` เพียงอย่างเดียว |

`node_modules/` สร้างใหม่ได้จาก lockfile แต่เป็น dependency ที่เครื่องต้องใช้ ไม่จำเป็นต้องลบเพื่อจัดระเบียบ source

## สิ่งที่ตรวจแล้วควรเก็บ

- `scripts/test-*.cjs`, `scripts/check-*-browser.cjs`, `scripts/helpers/`, `scripts/fixtures/`: มี tests, browser harness และเอกสารอ้างอิงจริง การไม่ถูก import จากหน้าเว็บไม่ได้หมายความว่าไม่ได้ใช้
- `.github/workflows/cron.yml`: เป็น scheduled workflow สำหรับ follow-up ไม่ใช่ไฟล์ทดลอง
- `supabase/automation.sql`, `automation-safety.sql` และ SQL อื่น: เป็น schema/RPC/upgrade/manual operations ต้องดู dependency และประวัติการติดตั้งก่อนย้ายหรือลบ
- `public/`: ไฟล์ถูกเรียกผ่าน URL ได้โดยไม่ต้องมี TypeScript import การหา import ไม่พบจึงไม่พอที่จะตัดสินว่าลบได้
- `.env.local`, `.env.example`, `package-lock.json`: เป็น config/dependency contract; `.env.local` ต้องอยู่นอก version control
- route aliases ของ webhook: อาจเป็น Callback URL ที่ Meta ตั้งไว้ ต้องตรวจผู้เรียกภายนอกก่อนลบ

## โครงสร้างที่แนะนำ

โครงสร้างปัจจุบันแยกตาม feature อยู่แล้ว จึงควรพัฒนาต่อจากโครงนี้ ไม่จำเป็นต้องย้ายทุกอย่างเข้า `src/` เพื่อให้อ่านง่าย

```text
app/
  (dashboard)/
    customers/{page,loading,error}.tsx
    chatbot/...
  api/                         # ตรวจสิทธิ์/validate แล้วเรียก service
components/
  ui/                          # ปุ่ม input skeleton ที่ไม่ผูกธุรกิจ
  shared/                      # สถานะ/องค์ประกอบร่วมของหลายฟีเจอร์
  customers/                   # UI เฉพาะลูกค้า
  chatbot/
hooks/                         # client hooks ที่ใช้ซ้ำ
lib/
  features/<feature>/          # business logic, queries, validation ของฟีเจอร์
  integrations/facebook/       # ติดต่อ provider และ webhook
  supabase/                    # browser/server/middleware clients
  auth.ts                      # สิทธิ์ที่ใช้ร่วมกัน
  tenant.ts
supabase/                      # SQL พร้อมลำดับติดตั้งที่ชัดเจน
scripts/
  helpers/
  fixtures/
tests/                         # ชุดทดสอบที่รันผ่าน test runner
docs/
```

หน้าหรือ route ควรทำหน้าที่ประกอบข้อมูลและ UI ส่วน query ที่ซับซ้อนอยู่ใน `lib/features/<feature>/` หาก helper ใช้เฉพาะ route เดียว สามารถวางใน `_components/` หรือ `_lib/` ใกล้ route ได้ โดยใช้หลักเดียวกันทั้งทีม

แยก server/client boundary ให้ชัด: server modules ที่ใช้ secret ใช้ `server-only`; `'use client'` เฉพาะส่วนที่ต้องใช้ state, effect หรือ browser API หลีกเลี่ยง barrel file ที่รวมทั้งสองฝั่งเข้าด้วยกัน

ระยะถัดไปอาจจัด `scripts` เป็น `checks/`, `diagnostics/`, `tests/` แล้วปรับเอกสาร/CI/fixture paths ใน commit เดียว ไม่ควรย้ายทันทีเพียงเพื่อให้โฟลเดอร์ดูสั้นลง เช่นเดียวกับ SQL: ใช้ timestamp migrations สำหรับงานใหม่ได้หลังจัดทำ baseline และลำดับ dependency ของ SQL เดิมครบแล้ว

ตรวจขอบเขตโมดูลและ import graph ด้วย `node scripts/check-architecture.cjs` ตาม [โครงสร้างเดิมของโปรเจกต์](PROJECT-STRUCTURE.md)

## ผลตรวจหลังจัดรูปแบบ

- `npm.cmd run format:check`: ผ่าน
- `npm.cmd run lint`: 0 errors, 12 warnings (คำเตือนเดิมเรื่อง hook dependencies และรูปภาพ)
- `node scripts/check-architecture.cjs`: ตรวจ 373 modules ไม่พบ unresolved import, cycle, relative import หรือ boundary violation
- `tsc --noEmit --incremental false --allowImportingTsExtensions`: ผ่าน โดยระบุ flag นี้เพราะ tests เดิม import ไฟล์ลงท้าย `.ts`; ไม่ได้แก้ tsconfig เพื่อกลบปัญหาเดิม
- ชุด Dashboard/Auth/Webhook/timeout ผ่าน 31 tests และชุด smart follow-up/manual context ผ่าน 20 tests รวม 51 tests ไม่ได้เรียก provider จริง
- `git diff --check`: ผ่าน

การจัดรูปแบบทำให้ diff กว้าง ควรตรวจ commit รอบนี้ด้วย diff ที่ไม่เน้น whitespace และไม่รวมการเปลี่ยนพฤติกรรมใหม่ใน commit เดียวกัน ไม่ได้รัน production build หรือ deploy ในรอบนี้
