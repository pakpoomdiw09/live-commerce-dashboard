# Rollback ระบบ safety รุ่นใหม่

Migration นี้ไม่เปลี่ยนข้อมูลบัญชี คีย์ หรือ routes ไม่ต้อง drop ตารางใหม่เพื่อ rollback และต้องเก็บ audit ไว้

1. หยุดการ deploy และตรวจ `tenant_automation_controls` ด้วย service/admin connection ที่เชื่อถือได้
2. หากมี `stopped=true` ให้คง app version/flag ที่บังคับ stop ต่อไป จนตั้งค่า tenant auto_reply เป็นปิด รวมถึง follow-up policy และ vision automation ของร้านนั้นได้ครบ ห้ามปิด safety flag แล้วปล่อย legacy workers ทำงาน
3. หากจำเป็นต้องหยุดระบบทั้งเซิร์ฟเวอร์ ให้หยุด workers และใช้ environment switches เดิมร่วมกับ tenant switches: `AGENT_CONTROL_KILL_SWITCH=true` เพียงตัวเดียวไม่หยุด keyword replies เดิมทั้งหมด
4. หลังยืนยันว่า legacy automation ของร้านที่หยุดถูกปิดแล้ว จึงตั้ง `SNAPBOT_SAFETY_ENABLED=false` ทุก instance และ restart/deploy กลับ
5. ตาราง `tenant_automation_controls`, `tenant_automation_audit` และ RPC ใหม่คงไว้ได้ เพราะไม่มี caller เมื่อ flag ปิด ไม่มีการส่งย้อนหลังหรือคืนเครดิตแบบคาดเดา
6. ไม่ย้อน grant เลขบัญชีเต็มให้ staff การจำกัดสิทธิ์และการป้องกันสลิปไม่มี ref/ยอดผิดเป็น security fix ที่ควรคงไว้

การ rollback นี้เป็น runbook ยังไม่ได้ดำเนินการกับ Supabase หรือ production จริง
