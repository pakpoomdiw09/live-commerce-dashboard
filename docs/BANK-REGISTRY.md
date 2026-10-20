# Bank Registry และตัวเลือกธนาคาร SnapBot

ตรวจข้อมูลวันที่ 16 ตุลาคม 2569 ใช้ `lib/features/banking/banks.ts` เป็นแหล่งข้อมูลกลางสำหรับรหัส ชื่อไทย/อังกฤษ alias ประเภท สถานะตรวจสลิป และไฟล์โลโก้

## ขอบเขตและแหล่งอ้างอิง

- [รายงานธนาคารพาณิชย์ ธปท.](https://app.bot.or.th/BTWS_STAT/statistics/BOTWEBSTAT.aspx?reportID=904): ข้อมูล ส.ค. 2569 ปรับปรุง 18 ก.ย. 2569 มี 29 ธนาคารที่ยังดำเนินการ หลังตัดแถวธนชาตที่ควบรวมและ ANZ ที่ปิดดำเนินการ
- [สถาบันการเงินเฉพาะกิจ ธปท.](https://www.bot.or.th/en/our-roles/financial-institutions/financial-institutions/sfi-supervisions.html): ออมสิน อาคารสงเคราะห์ ธ.ก.ส. EXIM SME Development Bank และธนาคารอิสลามฯ รวม 6 ธนาคาร ไม่รวมบรรษัทประกันสินเชื่อฯ ซึ่งไม่ใช่ธนาคารรับฝากเงิน
- [ใบอนุญาต CLICX](https://app.bot.or.th/BOTLicenseCheck/License/ViewDetail?id=69): เพิ่มเมื่อยืนยันสถานะแล้ว ไม่เพิ่มกลุ่ม virtual bank ที่เพียงได้รับอนุมัติจัดตั้ง
- [รหัสธนาคารของ SlipOK](https://slipok.com/api-documentation/bank-code/): รองรับรหัสที่เอกสารประกาศ 18 แห่งเท่านั้น ชื่อในเอกสารบางแห่งเก่า จึงเก็บ alias และแสดงชื่อปัจจุบันตาม ธปท.

รวม 35 ธนาคาร และช่องทางพร้อมเพย์อีกหนึ่งรายการ ไม่มีเพดาน 17 ธนาคาร รายการที่เพิ่มได้ไม่ได้หมายความว่าทุกธนาคารมีบัญชีรายย่อยหรือโอนผ่านทุกช่องทางได้ ต้องมีบัญชีจริงของร้านและตรวจเงื่อนไขธนาคาร

ลำดับ: KBANK → SCB → KTB → BBL → BAY จากนั้นเรียงชื่อไทยโดยไม่นับคำนำหน้า “ธนาคาร” รวมพร้อมเพย์ ไม่มีธนาคารซ้ำจาก alias

## รหัสและการตรวจสลิป

รหัสเดิม KBANK/SCB/KTB/BBL/BAY/TTB/GSB/PROMPTPAY ไม่เปลี่ยน ค่า `TMB` และ `TTBNK` ยังชี้ TTB; `TTB` ยังคง SlipOK `011` ไม่ใช้ `076` ที่ปรากฏผิดในชุดรูปบางแหล่ง

| รหัสเก็บใน SnapBot | SlipOK | Alias เพิ่มเติม |
|---|---|---|
| BBL | 002 | — |
| KBANK | 004 | — |
| KTB | 006 | — |
| TTB | 011 | TMB, TTBNK |
| SCB | 014 | — |
| BAY | 025 | — |
| KKP | 069 | KK |
| CIMB | 022 | CIMBT |
| TISCO | 067 | — |
| UOB | 024 | UOBT |
| TCRB | 071 | TCD, ไทยเครดิตเพื่อรายย่อย |
| LH | 073 | LHB, LHFG |
| ICBC | 070 | ICBCT |
| SME | 098 | — |
| BAAC | 034 | — |
| EXIM | 035 | — |
| GSB | 030 | — |
| GHB | 033 | — |

ธนาคารอีก 17 แห่งมี `slipCode:null`, `support:manual` และข้อความยังไม่รองรับการตรวจอัตโนมัติ ได้แก่ SCBT, SMTB, MEGA, BOC, CLICX, JPM, CITI, SMBC, DB, BNP, MHCB, BOFA, RHB, IOB, OCBC, HSBC, IBANK ไม่เดารหัสจาก SWIFT/ชุดรูปหรือถือว่ามีธนาคารแล้วจะตรวจเงินได้

`lib/features/slips/process.ts` ใช้ `findBank` จาก Registry แทน mapping อีกชุดสำหรับเทียบธนาคาร เงื่อนไขยอด ผู้รับ สลิปซ้ำ เครดิต และการยืนยันเงินจาก SlipOK เดิมยังทำงานตามเดิม ไม่ใช้ AI ยืนยันเงิน พร้อมเพย์คงการเทียบ proxy เดิม

ไม่เพิ่ม TMB/ธนชาตเป็นธนาคารแยก ไม่เพิ่ม RBS, ANZ หรือ MUFG/BTMU ที่พ้นรายชื่อปัจจุบัน Citi สาขาไทยยังเป็นนิติบุคคลที่เปิดดำเนินการ แม้ธุรกิจรายย่อยย้ายไป UOB; SMBC/SMTB และ ICBC/BOC เป็นคนละธนาคารและห้ามใช้โลโก้แทนกัน

## Component ที่หน้าใช้งานจริง

- `components/banking/BankSelector.tsx`: combobox/listbox ค้นหาไทย อังกฤษ รหัส SlipOK และ alias ใช้ลูกศร Home/End/Enter/Escape/Tab ปิดเมื่อคลิกภายนอก รองรับ IME และหยุด Enter ไม่ให้ไปบันทึกบัญชีโดยไม่ตั้งใจ
- `components/settings/BankAccountsManager.tsx`: เพิ่ม/แก้บัญชีจริงบน `/slips?tab=banks` ใช้ selector ใหม่ มีโลโก้ 56px บนการ์ด
- `components/settings/TenantSettingsForm.tsx`: ใช้ selector เดียวกันสำหรับสร้างร้าน ไม่มี mapping ซ้ำ
- `components/banking/BankLogo.tsx` และ `BankLogoImage.tsx`: ใช้ไฟล์ local พร้อม fallback เมื่อไม่มีไฟล์หรือโหลดล้มเหลว ไม่ใช้ตัวอักษรเป็นโลโก้ และไม่โหลด CDN ภายนอกใน production

รายละเอียดโลโก้ที่ติดตั้ง เวอร์ชัน ไฟล์ แหล่งที่มา สิทธิ์ และรายการที่ขาดอยู่ใน `docs/BANK-LOGO-SOURCES.md` และ `public/banks/manifest.json` ไม่อ้างสิทธิ์เครื่องหมายการค้าหรือการรับรองจากธนาคาร

## ติดตั้งฐานข้อมูล

ฐานข้อมูลเดิมจำกัดไว้ 8 รหัส จึงต้องรัน **`supabase/bank-registry.sql` หลัง `slip-bank-controls.sql`** บน staging ก่อน ใช้ migration แบบ additive เปลี่ยน allow-list และ seed trigger สำหรับร้านใหม่ ไม่เขียนทับเลขบัญชี ไม่ลบข้อมูล และคง RPC/สิทธิ์ owner/audit เดิม

ไฟล์ SQL สร้างจาก Registry ด้วย `node scripts/sync-bank-registry.cjs` ตรวจความตรงกันด้วย `node scripts/sync-bank-registry.cjs --check` เมื่อต้องเพิ่มธนาคารในอนาคตต้องตรวจแหล่งทางการและสิทธิ์โลโก้ แล้วสร้าง migration รุ่นถัดไปอย่างปลอดภัย

หากยังไม่ได้ติดตั้ง migration ธนาคารใหม่จะบันทึกไม่ผ่าน constraint โดย API แสดงข้อความแจ้งติดตั้ง migration ไม่ข้ามข้อจำกัดของ DB

**ยังไม่ได้รัน migration บนฐานข้อมูลจริง ไม่เปิด flag เพิ่ม ไม่เปลี่ยน .env.local และไม่ deploy**

## การทดสอบและ Rollback

- `scripts/test-bank-registry.cjs`: ความครบของรายการ ไม่ซ้ำ ลำดับ รหัส SlipOK/alias เดิม ปฏิเสธ bank matching ที่ยังไม่รองรับ ความปลอดภัยและ hash ของรูปจริง ทดสอบ Postgres แยกด้วย PGlite ให้ครบทุกธนาคารผ่าน owner RPC เพิ่ม/แก้/seed/audit/tenant isolation และ migration รันซ้ำ
- `scripts/check-bank-selector-browser.cjs`: Chrome เรียก component จริงกับ API จำลอง เสิร์ฟโลโก้ local ตรวจ dropdown เลือกทุกรายการ ค้นหา keyboard เพิ่ม/แก้รหัส โลโก้โหลดจริง fallback มือถือ/แท็บเล็ต/desktop ภาพอยู่ `docs/screenshots/bank-selector-*.png`
- TypeScript, lint และ production build รวม regression ระบบตรวจสลิป/QR เดิม ไม่เรียก SlipOK ไม่ใช้ข้อมูลบัญชีจริงและไม่ส่ง Messenger

Rollback UI: คืนไฟล์ส่วน Registry/Selector/Logo และการ import ของสองหน้าฟอร์มจาก release ก่อนหน้า **เฉพาะไฟล์ของงานนี้** เก็บ SQL allow-list ที่ขยายแล้วและข้อมูลธนาคารใหม่ไว้ ไม่ย้อน constraint ให้เหลือ 8 รหัสขณะมีบัญชีใหม่ เพราะจะทำให้ข้อมูลเดิมไม่ผ่านข้อกำหนด ใช้ backup/release artifact ของเวอร์ชันก่อนแก้ ห้าม reset workspace ที่มีงานอื่นค้างอยู่
