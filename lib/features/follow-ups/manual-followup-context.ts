export type ChatEvidence={id:string;sender:string;body:string|null;created_at:string}
type Selection={amount?:unknown;message_id?:unknown;quote?:unknown;issue_message_id?:unknown;issue_quote?:unknown}
/** A model may select a quoted amount, but cannot introduce a new amount or payment status. */
export function followUpChatDraft(value:Selection,history:ChatEvidence[]){
 const message=history.find(item=>item.id===value.message_id)
 const quote=typeof value.quote==='string'?value.quote.trim():''
 const amount=typeof value.amount==='string'?value.amount.trim():''
 const supported=message&&quote.length>0&&quote.length<=400&&message.body?.includes(quote)
  && /^\d[\d,]*(?:\.\d{1,2})?$/.test(amount)&&Number.isFinite(Number(amount.replaceAll(',','')))
  &&Number(amount.replaceAll(',',''))>0
  &&(quote.match(/\d[\d,]*(?:\.\d{1,2})?/g)??[]).some(token=>token===amount)
 const text=supported
  ?`สวัสดีค่ะ ขออนุญาตติดตามเรื่องที่คุยกันไว้ยอด ${amount} บาทนะคะ ไม่ทราบว่ายังต้องการให้ช่วยดำเนินการต่อ หรือมีข้อขัดข้องเรื่องการโอนที่อยากให้ช่วยไหมคะ`
  :'สวัสดีค่ะ ขออนุญาตติดตามเรื่องที่คุยกันไว้นะคะ หากยังสนใจหรือต้องการความช่วยเหลือเพิ่มเติม แจ้งได้เลยค่ะ'
 const issueMessage=history.find(item=>item.id===value.issue_message_id)
 const issueQuote=typeof value.issue_quote==='string'?value.issue_quote.trim():''
 const issue=issueMessage&&issueQuote.length>0&&issueQuote.length<=400&&issueMessage.body?.includes(issueQuote)
  ?{messageId:issueMessage.id,quote:issueQuote}:null
 return {draft:text,analysis:{amount:supported?amount:null,evidence:supported?{messageId:message.id,quote}:null,transferIssue:issue,paymentStatus:'unverified' as const}}
}
