# การปรับข้อความหน้าจอเป็นภาษาไทย

วันที่ 16 ตุลาคม 2569

- ปรับข้อความปุ่ม หัวข้อ คำอธิบาย ข้อความช่วยเหลือ และชื่อสำหรับโปรแกรมอ่านหน้าจอในหน้าจัดการสลิป บัญชี แชท ระบบอัตโนมัติ รายงาน ตั้งค่า และผู้ดูแลระบบ
- เปลี่ยนชื่อผู้ให้บริการตรวจสลิปที่แสดงบนหน้าจอเป็น “ผู้ให้บริการตรวจสอบ” หรือ “ระบบตรวจสอบสลิปอัตโนมัติ” และชื่อระบบชำระเงินเป็น “ระบบตรวจสอบการชำระเงิน”
- ลบลิงก์ “ที่มาและสิทธิ์โลโก้” ใต้ตัวเลือกธนาคาร โดยเก็บไฟล์ที่มา สิทธิ์ และโลโก้ไว้ทั้งหมด
- เปลี่ยนแบนเนอร์เป็น “จัดการบัญชีธนาคาร และผลตรวจจากผู้ให้บริการในที่เดียว”
- ตัวเลือกช่องทางรับชำระเงินเหลือเฉพาะ “พร้อมเพย์ · สร้างหรือนำเข้า QR”
- เพิ่มคำแปลสถานะ ประเภทภาพ และเหตุการณ์ในประวัติการทำงาน โดยคงค่าที่จัดเก็บในฐานข้อมูลและส่งผ่านระบบเชื่อมต่อเดิม
- คงชื่อผลิตภัณฑ์ SnapBot รหัส QR ชนิดไฟล์ รหัสคำสั่งที่ลูกค้าต้องพิมพ์ ชื่อไฟล์ และชื่อคีย์ตั้งค่าที่ต้องใช้จริง
- คงชื่อฟังก์ชัน ที่อยู่ผู้ให้บริการ ตัวแปรสภาพแวดล้อม และค่าปุ่มคีย์บอร์ดภายใน ไม่มีการแก้ฐานข้อมูลหรือไฟล์สภาพแวดล้อม

## การตรวจสอบ

- ตรวจชนิดข้อมูลด้วย `npx.cmd tsc --noEmit`
- สร้างรุ่นใช้งานจริงด้วย `npm.cmd run build`
- ทดสอบตัวเลือกธนาคารด้วยเบราว์เซอร์จริง ครอบคลุม 18 ธนาคาร การค้นหา คีย์บอร์ด การเพิ่มและแก้ไขบัญชี โลโก้ และหน้าจอขนาด 375/768/1440 พิกเซล
- ปรับข้อความที่คาดหวังในชุดทดสอบให้ตรงกับข้อความภาษาไทยใหม่ และคงการตรวจพฤติกรรมเดิม

ผลตรวจรอบสุดท้าย: ตรวจชนิดข้อมูลผ่าน สร้างรุ่นใช้งานจริงผ่าน และทดสอบเบราว์เซอร์ผ่าน โดยยังมีคำเตือนตรวจรูปแบบโค้ดเดิมในไฟล์ส่วนอื่น

ชุดทดสอบทั้งหมดผ่าน 316 จาก 319 รายการ อีก 3 รายการเป็นปัญหาเดิมจากงานก่อนหน้า: `test-admin-feature-bypass.cjs` มีตารางจำลองขาด `is_active` และ `test-dashboard-page-scope.cjs` สองกรณีมีสภาพแวดล้อมจำลองขาด `process` ไม่มีข้อผิดพลาดใหม่จากงานแปลข้อความ

## รายการไฟล์ที่แก้ไข

- `app/(dashboard)/analytics/page.tsx`
- `app/(dashboard)/billing/page.tsx`
- `app/(dashboard)/broadcast/page.tsx`
- `app/(dashboard)/chatbot/conversations/page.tsx`
- `app/(dashboard)/chatbot/follow-ups/page.tsx`
- `app/(dashboard)/chatbot/images/page.tsx`
- `app/(dashboard)/comment-replies/page.tsx`
- `app/(dashboard)/inbox/page.tsx`
- `app/(dashboard)/overview/loading.tsx`
- `app/(dashboard)/settings/page.tsx`
- `app/(dashboard)/shop/page.tsx`
- `app/(dashboard)/slips/page.tsx`
- `app/admin/page.tsx`
- `app/admin/provider/page.tsx`
- `app/api/cron/payment-pro/route.ts`
- `app/api/slips/[id]/approve/route.ts`
- `app/p/[id]/page.tsx`
- `app/receipts/[id]/page.tsx`
- `app/select-page/page.tsx`
- `components/banking/BankSelector.tsx`
- `components/shared/FeatureLocked.tsx`
- `components/shared/SetupNotice.tsx`
- `components/admin/AdminShell.tsx`
- `components/admin/ProviderBalance.tsx`
- `components/billing/BillingClient.tsx`
- `components/billing/BillingProof.tsx`
- `components/broadcast/BroadcastClient.tsx`
- `components/chatbot/AgentControlCenter.tsx`
- `components/chatbot/AgentUserGuide.tsx`
- `components/chatbot/AutomationEmergencyStop.tsx`
- `components/chatbot/BotPlayground.tsx`
- `components/chatbot/ChatRuleForm.tsx`
- `components/chatbot/ConversationsClient.tsx`
- `components/chatbot/ImageRulesClient.tsx`
- `components/chatbot/MessengerPreview.tsx`
- `components/chatbot/SmartFollowUpsClient.tsx`
- `components/chatbot/VisionCenter.tsx`
- `components/comment-rules/RuleEditor.tsx`
- `components/inbox/ChatList.tsx`
- `components/inbox/Conversation.tsx`
- `components/inbox/ConversationHistory.tsx`
- `components/inbox/CustomerPanel.tsx`
- `components/inbox/InboxProCenter.tsx`
- `components/inbox/ReplyBox.tsx`
- `components/overview/ActionRequired.tsx`
- `components/overview/PremiumOverview.tsx`
- `components/overview/PremiumOverviewPage.tsx`
- `components/payments/PaymentModal.tsx`
- `components/select-page/ConnectFacebookButton.tsx`
- `components/select-page/PageCard.tsx`
- `components/settings/BankAccountsManager.tsx`
- `components/settings/TenantSettingsForm.tsx`
- `components/shell/AppShell.tsx`
- `components/shell/PageStatus.tsx`
- `components/shop/ProductForm.tsx`
- `components/shop/ShopClient.tsx`
- `components/slips/BankQrWorkspace.tsx`
- `components/slips/PaymentAutomationSettings.tsx`
- `components/slips/PaymentChannelStatus.tsx`
- `components/slips/PaymentChannelsGuide.tsx`
- `components/slips/PaymentProCharts.tsx`
- `components/slips/PaymentProDashboard.tsx`
- `components/slips/PaymentProEvidence.tsx`
- `components/slips/ReceivingCodeManager.tsx`
- `components/slips/SlipDetailPanel.tsx`
- `components/slips/SlipsDashboard.tsx`
- `components/slips/SlipsWorkspace.tsx`
- `components/slips/VerifySlipForm.tsx`
- `components/ui/ImagePicker.tsx`
- `lib/features/banking/banks.ts`
- `lib/features/payments/payment-pro-flags.ts`
- `lib/features/payments/payment-pro-server.ts`
- `lib/features/payments/payment-validation.ts`
- `lib/provider-quota.ts`
- `lib/features/slips/slipok.ts`
- `lib/ui-labels.ts`
- `scripts/check-bank-selector-browser.cjs`
- `scripts/test-agent-control-ui.cjs`
- `scripts/test-premium-overview.cjs`
- `scripts/test-slip-single-page.cjs`

- `docs/THAI-UI-LOCALIZATION.md`
- `docs/screenshots/bank-selector-375.png`
- `docs/screenshots/bank-selector-768.png`
- `docs/screenshots/bank-selector-1440.png`
