# อนุมัติคำสั่งซื้อจากสลิปอัตโนมัติ

รัน `billing-auto-approval.sql` ทั้งไฟล์ใน Supabase SQL Editor **หลัง** `payments.sql`, `billing-slip-topups.sql`, `admin-feature-bypass.sql` และ `platform-dashboard.sql` ถ้ารันไฟล์เหล่านี้ใหม่ ให้รันไฟล์อนุมัติอัตโนมัตินี้เป็นไฟล์สุดท้ายอีกครั้ง สามารถรันซ้ำได้โดยไม่เพิ่มเครดิตซ้ำ

ใช้การตั้งค่าบัญชีแพลตฟอร์มและผู้ให้บริการตรวจสลิปใน `.env.local`:

- SlipOK (ค่าเริ่มต้น): `SLIPOK_BRANCH_ID`, `SLIPOK_API_KEY`
- ZWIZ API v2: ตั้ง `SLIP_VERIFICATION_PROVIDER=zwiz`, `ZWIZ_API_KEY` และตั้ง `ZWIZ_API_URL` หากไม่ได้ใช้ production endpoint เริ่มต้น
- `NEXT_PUBLIC_PROMPTPAY_ID`, `NEXT_PUBLIC_BANK_ACCOUNT_NO`, `NEXT_PUBLIC_BANK_ACCOUNT_NAME`, `NEXT_PUBLIC_BANK_NAME`, `PAYMENT_BANK_CODE`

ค่าที่ใช้เลือก provider เป็นการตั้งค่าระดับระบบ จึงมีผลกับทุก tenant และเส้นทางตรวจสลิปที่ใช้ verifier กลางทั้งหมด บัญชีรับเงินที่ผูกกับสาขา SlipOK ต้องตรงกับบัญชีแพลตฟอร์ม ส่วน ZWIZ จะได้รับบัญชีรับเงินของ payment session จากข้อมูลที่เก็บฝั่งเซิร์ฟเวอร์ ระบบตรวจผลสำเร็จของ Provider และตรวจยอด/บัญชี/เวลาอีกครั้งก่อนบันทึกหลักฐาน คำสั่งซื้อใหม่เก็บบัญชีรับเงินไว้ตั้งแต่สร้าง คำสั่งซื้อเก่าที่ไม่มีบัญชีในรายการใช้ค่าบัญชีที่ตั้งไว้ในระบบ

เมื่อร้านค้าแนบสลิปในประวัติ `/billing` ระบบเก็บรูปแบบ private แล้วตรวจอัตโนมัติ ยอมรับยอดเงินตั้งแต่ราคาแพ็กเกจขึ้นไป จำนวนเครดิตเพิ่มตามแพ็กเกจที่ซื้อ ไม่เพิ่มตามยอดเงินที่โอนเกิน

- เติมข้อความเพิ่ม `broadcast_topup_credits`
- เติมตรวจสลิปเพิ่ม `slip_quota_credits`
- ซื้อ Starter/Pro เปิดแพ็กเกจตามพฤติกรรมเดิม ระบบ QR เดิมยอมรับยอดเงินที่โอนเกินเช่นกัน
- สลิปไม่ผ่านหรือ Provider ขัดข้อง คำสั่งซื้อยังเป็น `pending` แสดงเหตุผลใน `/billing` และ `/admin/approvals`
- กดตรวจสอบอีกครั้งเพื่อใช้รูปเดิม หากมีหลักฐานที่ตรวจผ่านและบันทึกไว้แล้ว จะเพิ่มเครดิตโดยไม่เรียก Provider ซ้ำ

ทะเบียน TransRef ร่วมกันระหว่างคำสั่งซื้อเติมเครดิต แพ็กเกจ QR และสลิปขายสินค้า ป้องกันการนำรายการโอนที่ยอมรับแล้วกลับมาใช้ซ้ำ รวมถึงการส่งพร้อมกันหลายคำสั่งซื้อ และเพิ่มทะเบียน hash รูปสลิปสำหรับทั้งแพ็กเกจ QR และคำสั่งซื้อเติมเครดิต รูปที่อนุมัติด้วยผู้ดูแลก็ถูกลงทะเบียนด้วยเมื่อมี hash

บันทึกหลักฐานที่ตรวจผ่านก่อนเพิ่มเครดิต และเพิ่มเครดิตพร้อมเปลี่ยนสถานะคำสั่งซื้อเป็น `approved` ใน transaction เดียว หากเพิ่มเครดิตไม่สำเร็จ ยังมีหลักฐานให้ลองใหม่ได้โดยไม่ต้องโอนซ้ำ เมื่อสำเร็จ UI แสดง “อนุมัติสำเร็จ! ระบบเพิ่มเครดิตให้เรียบร้อยแล้ว” พร้อมอัปเดตยอดคงเหลือ

สำหรับ SlipOK อ้างอิง [SlipOK Check Slip](https://slipok.com/api-documentation/check-slip/) และส่ง `log: true` เพื่อให้ Provider ตรวจบัญชีและสลิปซ้ำ ไม่ส่งตัวเลือก `amount` ของ Provider เพราะการตรวจยอดทำในระบบนี้ ส่วน ZWIZ ใช้ API v2 พร้อมบัญชีรับเงินจาก server-side snapshot เดียวกัน

ตรวจสอบโดยไม่อ่าน `.env.local` หรือเรียกบริการจริง:

```powershell
node scripts/test-platform-dashboard-api.cjs
node scripts/test-platform-dashboard-sql.cjs <path-to-@electric-sql/pglite>
node scripts/test-payment-validation.cjs
node scripts/test-payment-api.cjs
npm.cmd run build
```
