import {NextRequest,NextResponse} from 'next/server'
import {agentControlTenant} from '@/lib/agent-control-server'
import {inboxError,InboxError} from '@/lib/inbox-server'
import {CHAT_RULE_COLUMNS,matchChatRule,ruleOrder,wantsHuman,type ChatRule} from '@/lib/chatbot'
import {inputRisk,groundedAgentReply,knowledgeRequiresHuman,type AgentKnowledge,type AgentProduct} from '@/lib/agent-control-core'
import {loadBotSettings} from '@/lib/chatbot-server'
/** Deterministic dry-run only. This module deliberately imports no AI provider or Sender. */
export async function POST(req:NextRequest){try{
 const {db,tenantId,config}=await agentControlTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 if(!config.flags.agent_playground_enabled)throw new InboxError('ยังไม่เปิด Playground',403,'FEATURE_DISABLED')
 const input=await req.json().catch(()=>null)
 if(typeof input?.text!=='string'||!input.text.trim()||input.text.length>2000)throw new InboxError('ข้อความทดสอบต้องมี 1–2,000 ตัวอักษร')
 const settings=await loadBotSettings(db,tenantId)
 const rules=await db.from('chat_rules').select(CHAT_RULE_COLUMNS).eq('tenant_id',tenantId).eq('is_active',true)
 if(rules.error)throw rules.error
 const rule=matchChatRule(((rules.data??[]) as ChatRule[]).sort(ruleOrder),input.text)
 const risk=inputRisk(input.text)
 const human=risk||wantsHuman(settings?.handover_keywords??[],input.text)
 if(human)return NextResponse.json({mode:'simulation',route:'ADMIN',matchedKeyword:null,proposedText:'แนะนำส่งต่อแอดมิน',reason:risk??'CUSTOMER_REQUESTED_HUMAN',sourceIds:[],guardrails:'REQUIRE_HUMAN_REVIEW',estimatedAiCredits:0,chargedAiCredits:0,providerCalled:false})
 if(rule)return NextResponse.json({mode:'simulation',route:'KEYWORD',matchedKeyword:rule.name,proposedText:rule.reply_text??'[รูปภาพตามกฎ]',reason:'HIGHEST_PRIORITY_MATCH',sourceIds:[rule.id],guardrails:'PRECONFIGURED_RULE',estimatedAiCredits:0,chargedAiCredits:0,providerCalled:false})
 const [knowledge,catalog]=await Promise.all([
  config.flags.agent_knowledge_base_enabled?db.from('agent_knowledge_sources').select('id,kind,title,content,is_active').eq('tenant_id',tenantId).eq('is_active',true).order('id').limit(50):Promise.resolve({data:[],error:null}),
  db.from('products').select('code,name,price,stock,description').eq('tenant_id',tenantId).eq('is_active',true).order('code').limit(100),
 ])
 if(knowledge.error||catalog.error)throw knowledge.error??catalog.error
 const sources=(knowledge.data??[]) as AgentKnowledge[],products=(catalog.data??[]) as AgentProduct[]
 if(knowledgeRequiresHuman(input.text,sources))return NextResponse.json({mode:'simulation',route:'ADMIN',matchedKeyword:null,proposedText:'หัวข้อนี้ต้องส่งต่อแอดมิน',reason:'KNOWLEDGE_POLICY_HANDOFF',sourceIds:[],guardrails:'REQUIRE_HUMAN_REVIEW',estimatedAiCredits:0,chargedAiCredits:0,providerCalled:false})
 const normalized=input.text.toLocaleLowerCase('th-TH')
 const product=products.find(p=>normalized.includes(p.code.toLowerCase())||normalized.includes(p.name.toLowerCase()))
 const source=sources.find(k=>!['forbidden','handoff'].includes(k.kind)&&normalized.includes(k.title.toLowerCase()))
 const controlled=groundedAgentReply(JSON.stringify({decision:product||source?'ANSWER':'CLARIFY',knowledgeIds:source?[source.id]:[],productCodes:product?[product.code]:[]}),sources,products)
 return NextResponse.json({mode:'simulation',route:controlled.handoff?'ADMIN':'AI',matchedKeyword:null,proposedText:controlled.text,reason:controlled.reason,sourceIds:controlled.sourceIds,guardrails:controlled.handoff?'REQUIRE_HUMAN_REVIEW':'DATABASE_FACTS_ONLY',estimatedAiCredits:1,chargedAiCredits:0,providerCalled:false})
}catch(error){return inboxError(error)}}
