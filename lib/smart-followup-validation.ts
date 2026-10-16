import type {CommunicationPolicy,FollowUpWorkflow} from './smart-followup-types'
export function parseFollowUpSettings(input:unknown):{policy:CommunicationPolicy;workflows:FollowUpWorkflow[]}{
 if(!input||typeof input!=='object')throw new Error('ข้อมูลตั้งค่าไม่ถูกต้อง')
 const {policy,workflows}=input as {policy:CommunicationPolicy;workflows:FollowUpWorkflow[]}
 if(!policy||typeof policy.enabled!=='boolean'||typeof policy.quiet_enabled!=='boolean'||typeof policy.timezone!=='string')throw new Error('กรุณาตั้งค่านโยบายการติดต่อ')
 try{new Intl.DateTimeFormat('th-TH',{timeZone:policy.timezone}).format()}catch{throw new Error('เขตเวลาไม่ถูกต้อง')}
 for(const [key,min,max]of [['quiet_start',0,1439],['quiet_end',0,1439],['max_per_customer',1,20],['max_per_order',1,10]] as const)if(!Number.isInteger(policy[key])||policy[key]<min||policy[key]>max)throw new Error(`ค่า ${key} ไม่ถูกต้อง`)
 if(policy.quiet_enabled&&policy.quiet_start===policy.quiet_end)throw new Error('เวลาห้ามรบกวนเริ่มและสิ้นสุดต้องต่างกัน')
 if(!Array.isArray(workflows)||workflows.length!==3||new Set(workflows.map(w=>w.kind)).size!==3)throw new Error('ต้องมี Workflow ทั้ง 3 ประเภท')
 for(const w of workflows){
  if(!['payment','interested','after_sales'].includes(w.kind)||!Number.isInteger(w.version)||w.version<0||typeof w.enabled!=='boolean'||typeof w.use_ai!=='boolean'||typeof w.stop_on_reply!=='boolean'||!Array.isArray(w.steps)||w.steps.length<1||w.steps.length>3)throw new Error('Workflow ไม่ถูกต้อง (สูงสุด 3 ขั้นตามสิทธิ์เดิม)')
  let previous=0
  for(const step of w.steps){if(!Number.isInteger(step.delay_minutes)||step.delay_minutes<=previous||step.delay_minutes>43200||typeof step.text!=='string'||!step.text.trim()||step.text.trim().length>2000)throw new Error('เวลาต้องเพิ่มขึ้นทีละขั้น และข้อความยาว 1–2,000 ตัวอักษร');previous=step.delay_minutes}
 }
 return {policy,workflows}
}
