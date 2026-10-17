/** Display labels only. Stored statuses, API fields and provider codes stay unchanged. */
const labels:Record<string,string>={
 pending:'รอดำเนินการ',scheduled:'ตั้งเวลาแล้ว',processing:'กำลังดำเนินการ',completed:'สำเร็จ',
 sent:'ส่งแล้ว',failed:'ไม่สำเร็จ',cancelled:'ยกเลิก',skipped:'ข้ามแล้ว',requires_review:'รอตรวจสอบ',
 draft:'ฉบับร่าง',claimed:'รับงานแล้ว',reserved:'สำรองเครดิตแล้ว',refunded:'คืนเครดิตแล้ว',
 PENDING:'รอดำเนินการ',VERIFYING:'กำลังตรวจสอบ',VERIFIED:'ยืนยันการชำระเงินแล้ว',
 REVIEW_REQUIRED:'รอตรวจสอบ',REJECTED:'ปฏิเสธ',CANCELLED:'ยกเลิก',
 valid:'ตรวจสอบผ่าน',fake:'ไม่ผ่านการตรวจสอบ',duplicate:'รายการซ้ำ',wrong_receiver:'บัญชีผู้รับไม่ตรง',
 wrong_amount:'ยอดเงินไม่ตรง',error:'ตรวจสอบไม่สำเร็จ',paid:'ชำระเงินแล้ว',pending_payment:'รอชำระเงิน',shipped:'จัดส่งแล้ว',delivered:'ส่งถึงแล้ว',
 PRODUCT:'ภาพสินค้า',PAYMENT_SLIP:'สลิปชำระเงิน',GENERAL:'ภาพทั่วไป',UNKNOWN:'ไม่สามารถระบุประเภทได้',
 PRODUCT_SEARCH:'ค้นหาสินค้า',VERIFY_SLIP:'ตรวจสอบสลิป',RULE_REPLY:'ตอบกลับตามกฎ',HUMAN_HANDOFF:'ส่งต่อเจ้าหน้าที่',
 LOW_CONFIDENCE:'ความมั่นใจในการวิเคราะห์ไม่เพียงพอ',SLIP_DETECTED:'พบสลิปชำระเงิน',UNKNOWN_IMAGE:'ไม่สามารถระบุประเภทภาพได้',
 PRO_REQUIRED:'ต้องใช้แพ็กเกจมืออาชีพ',NO_CATALOG_MATCH:'ไม่พบสินค้าที่ตรงกัน',CATALOG_MATCH:'พบสินค้าที่ตรงกัน',MATCHED_RULE:'พบกฎตอบกลับที่ตรงกัน',NO_RULE:'ไม่พบกฎตอบกลับที่ตรงกัน',
 AMOUNT_MISMATCH:'ยอดเงินไม่ตรง',RECEIVER_NOT_CONFIRMED:'ยังไม่ยืนยันบัญชีผู้รับ',DUPLICATE_TRANSACTION:'รายการเดิมถูกใช้แล้ว',
 PROVIDER_ERROR:'ผู้ให้บริการขัดข้อง',PROVIDER_RESULT_UNKNOWN:'ยังไม่ทราบผลจากผู้ให้บริการ',
 ORDER_REQUIRED:'ยังไม่ได้เชื่อมโยงคำสั่งซื้อ',ORDER_CHANGED:'ข้อมูลคำสั่งซื้อเปลี่ยนแปลง',PAYMENT_TIME_INVALID:'เวลาโอนไม่ผ่านเงื่อนไข',
 AUTO_CONFIRM_DISABLED:'รอเจ้าของร้านยืนยัน',INSUFFICIENT_CREDITS:'เครดิตไม่เพียงพอ',ALL_CHECKS_PASSED:'ผ่านเงื่อนไขทั้งหมด',
 NOT_PROVIDER_VERIFIED:'ผู้ให้บริการยังไม่ได้ยืนยัน',MISSING_TRANSACTION_REFERENCE:'ไม่พบเลขอ้างอิงรายการ',INVALID_AMOUNT:'ยอดเงินไม่ถูกต้อง',
 keyword:'ตอบตามคำสำคัญ',ai:'ผู้ช่วยอัจฉริยะ',handoff:'ส่งต่อเจ้าหน้าที่',human:'เจ้าหน้าที่ดูแล',none:'ไม่มีการดำเนินการ',
 created:'สร้างรายการ',verified:'ยืนยันผลตรวจสอบ',reviewed:'บันทึกผลตรวจสอบ',
 approved:'อนุมัติ',rejected:'ปฏิเสธ',retry:'นำกลับเข้าคิว',recovered:'กู้คืนรายการ',
 verification_started:'เริ่มตรวจสอบ',provider_started:'เริ่มตรวจสอบกับผู้ให้บริการ',provider_result:'ได้รับผลจากผู้ให้บริการ',
 credit_charged:'หักเครดิต',credit_refunded:'คืนเครดิต',order_confirmed:'ยืนยันคำสั่งซื้อ',
 prompt_saved:'บันทึกคำสั่งผู้ช่วย',prompt_restored:'คืนค่าคำสั่งผู้ช่วย',knowledge_saved:'บันทึกฐานความรู้',knowledge_deleted:'ลบฐานความรู้',
 settings_updated:'ปรับการตั้งค่า',simulation_completed:'จำลองการตอบสำเร็จ',
}
/** Display-only replacement also covers older saved provider messages. */
export function neutralSlipText(value:string):string{
 return value.replace(/slip\s*ok/gi,'ระบบตรวจสอบสลิปอัตโนมัติ')
}
export function systemLabel(value:string|null|undefined,fallback='รอตรวจสอบรายละเอียด'):string{
 if(!value)return '—'
 if(labels[value])return labels[value]
 if(/[\u0e00-\u0e7f]/.test(value))return neutralSlipText(value).replace(/Payment (?:Verification )?Pro/g,'ระบบตรวจสอบการชำระเงิน').replace(/\btransaction\b/gi,'รายการเดิม')
 return fallback
}
