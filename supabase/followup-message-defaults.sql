-- Update defaults for future settings rows only; existing shop messages are preserved.
alter table public.bot_settings alter column followup_steps set default '[
  {"delay_minutes": 15, "text": "คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ"},
  {"delay_minutes": 60, "text": "แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ"}
]'::jsonb;
