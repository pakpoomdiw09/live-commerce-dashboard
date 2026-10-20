import type {FollowUpWorkflow} from './smart-followup-types'
export type FollowUpWorkflowDraft=Omit<FollowUpWorkflow,'steps'>&{steps:{delay_minutes:number|string;text:string}[]}
/** Preserve empty input while editing; convert minutes only when saving. */
export function serializeFollowUpWorkflows(workflows:FollowUpWorkflowDraft[]):FollowUpWorkflow[]{
 return workflows.map(workflow=>({...workflow,steps:workflow.steps.map((step,index)=>{
  const raw=String(step.delay_minutes).trim()
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1||Number(raw)>43200)
   throw new Error(`กรุณาระบุเวลาในขั้น ${index+1} เป็นจำนวนเต็ม 1–43,200 นาที`)
  return {...step,delay_minutes:Number(raw)}
 })}))
}
