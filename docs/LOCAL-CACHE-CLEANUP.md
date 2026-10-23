# เคลียร์ไฟล์ชั่วคราวในเครื่อง

ใช้ Node.js ของโปรเจกต์ ไม่ต้องติดตั้ง dependency เพิ่ม หยุด dev server, build และ browser/test processes ที่ใช้โฟลเดอร์เหล่านี้ก่อนลบจริง

```powershell
npm.cmd run clean:preview
npm.cmd run clean:cache
```

บน Bash ใช้ `npm run clean:preview` และ `npm run clean:cache` ได้เหมือนกัน คำสั่ง preview อ่านและรวมขนาดเท่านั้น ส่วน `clean:cache` ลบจริง หรือเรียก `node scripts/clean-cache.cjs` โดยตรงเพื่อ preview (เป็นค่าเริ่มต้น) และเพิ่ม `--apply` เพื่อลบ

รายการอนุญาตมีเพียง:

- `.tmp/` ทั้งหมด รวม logs, screenshots และไฟล์ทดลองที่เก็บไว้ในโฟลเดอร์นี้
- `.npm-audit-cache/`
- `.next/cache/`
- `.next-dev/cache/`
- `tsconfig.tsbuildinfo`

ถ้ายังต้องการไฟล์ทดลองหรือภาพใน `.tmp` ให้ย้ายไฟล์เหล่านั้นออกก่อน สคริปต์จะไม่แตะ `app`, `components`, `hooks`, `lib`, `public`, `supabase`, `tests`, `scripts/fixtures`, `.env.local`, `.git`, lockfile หรือ `node_modules` และไม่ลบ `.next` ทั้งก้อน จึงเก็บ build output เช่น `.next/server` และ `.next/BUILD_ID` ไว้

สคริปต์ผูก root กับตำแหน่งไฟล์ของตัวเอง ตรวจ package name และใช้รายการ path ตายตัว ไม่มี glob หรือ path จากผู้ใช้ ตรวจ path จริงและทุก ancestor รวมถึงไฟล์ย่อยก่อนลบ หากพบ symlink/junction จะหยุดก่อนเริ่มลบ สคริปต์ตรวจซ้ำขณะลบ และไม่ใช้ recursive rm ในการเคลียร์โปรเจกต์ หากพบไฟล์ถูกล็อกหรือมีไฟล์ใหม่ระหว่างลบจะหยุดและคืน exit code 1 โดยบางรายการก่อนหน้าอาจถูกลบไปแล้วได้ สามารถ preview และรันใหม่ได้หลังปิด process ที่เกี่ยวข้อง

การทดสอบไม่ใช่การรับประกันความปลอดภัยเมื่อมี process อื่นจงใจเปลี่ยน filesystem พร้อมกัน จึงควรรันขณะหยุดงานในโปรเจกต์

cache ที่ลบจะสร้างใหม่ตามการใช้งาน ทำให้ build/dev/image request ครั้งถัดไปอาจใช้เวลามากขึ้น ขนาด preview เป็นผลรวมขนาดไฟล์ ไม่ใช่พื้นที่ดิสก์ที่จะคืนได้แน่นอน

ใน checkout นี้ `.npm-audit-cache` มี 13 ไฟล์ที่ติดตามใน Git แม้เพิ่ม `.gitignore` แล้ว การลบจริงจึงทำให้ไฟล์เหล่านี้แสดงเป็น deleted ใน `git status` สคริปต์ไม่แก้ Git index และไม่ commit ให้

ตรวจสอบกลไกป้องกันการลบด้วย:

```sh
node --test scripts/test-clean-cache.cjs
```

ทดสอบใน temporary directories ที่สร้างแยกจากโปรเจกต์ ครอบคลุม dry run, ลบตาม allowlist, เก็บ source/tests/fixtures/build output, รันซ้ำเมื่อไม่มี cache และปฏิเสธ junction ทั้งที่ target, ancestor และด้านในโฟลเดอร์
