import {readStoreRuleItems,serializeStoreRuleItems} from '../../../lib/features/store-rules/store-rule-items'
import {compileShopRules,validateShopRules} from '../../../lib/features/store-rules/shop-persona-settings'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentControlCenter } from '../../../components/chatbot/AgentControlCenter'
import type { AgentOverviewData } from '../../../lib/features/agents/agent-overview-core'

const flags = { agent_control_center_enabled: true, agent_orchestrator_enabled: true, agent_knowledge_base_enabled: true, agent_playground_enabled: true, agent_analytics_enabled: true, agent_advanced_guardrails_enabled: true }
const state = { requests: [] as { url: string; method: string }[], changes: 0, trials: 0, ruleChanges: 0, failRuleSave: false, shopInstructions: 'เงื่อนไขเดิมของร้านที่ต้องเก็บไว้', personaSaves: [] as string[], empty: false, restriction: null as string | null, backendRestriction: null as string | null }
const data: AgentOverviewData = {
  updatedAt: '2026-10-17T05:00:00Z', canManage: true, masterEnabled: true, ready: true, readiness: [], page: { name: 'ร้านทดสอบ', configured: true },
  capabilities: { answers: true, products: true, slips: true, handoff: true, intent: true, followup: true }, available: { answers: true, products: true, slips: true, handoff: true, intent: true, followup: true },
  entitlements:Object.fromEntries(['answers','products','slips','handoff','intent','followup'].map(key=>[key,{allowed:true,code:null,message:''}])) as AgentOverviewData['entitlements'],
  quota: { plan: 'แพ็กเกจมืออาชีพ', used: 125, limit: 1000, remaining: 875, month: '2026-10-01' },
  repliesToday: 64, customersTotal: 120, handoffs: 3, averageSeconds: 2.4, successRate: 97.5, points: [],
  recent: [{ id: 'job', customer_id: 'customer', customer: 'ลูกค้าทดลอง', route: 'AI', status: 'sent', created_at: '2026-10-17T04:00:00Z', updated_at: '2026-10-17T04:00:02Z' }], notices: [],
}
window.fetch = async (input, init) => {
  const url = new URL(String(input), 'http://localhost'), method = init?.method ?? 'GET'
  state.requests.push({ url: url.pathname, method })
  if (!url.pathname.startsWith('/api/agent-control')) throw Error('Unexpected request')
  if(url.pathname==='/api/agent-control/rules'){
    if(state.failRuleSave)return new Response(JSON.stringify({error:'ทดสอบบันทึกไม่สำเร็จ'}),{status:503})
    const body=JSON.parse(String(init?.body)),items=readStoreRuleItems(state.shopInstructions),index=items.findIndex(item=>item.id===body.id)
    if(method==='POST')items.push({id:body.id,body:body.body,category:body.category??'general',enabled:body.enabled??true})
    else if(method==='PATCH')items[index]={...items[index],...(body.body!==undefined?{body:body.body}:{}),...(body.category!==undefined?{category:body.category}:{}),...(body.enabled!==undefined?{enabled:body.enabled}:{})}
    else if(method==='DELETE')items.splice(index,1)
    else throw Error('Unexpected rule method')
    state.shopInstructions=serializeStoreRuleItems(items);state.ruleChanges++
    return new Response(JSON.stringify({instructions:state.shopInstructions}))
  }
  if (method === 'PATCH' && url.pathname==='/api/agent-control') {
    const body=JSON.parse(String(init?.body));state.shopInstructions=body.shopRules?compileShopRules(validateShopRules(body.shopRules)):body.instructions;state.personaSaves.push(state.shopInstructions)
    return new Response(JSON.stringify({ok:true}))
  }
  if (method === 'PATCH') {
    if (state.backendRestriction) {
      state.restriction = state.backendRestriction
      return new Response(JSON.stringify({ error: 'โควตาผู้ช่วย AI หมด กรุณาเพิ่มโควตาก่อนเปิดใช้งาน', code: state.backendRestriction }), { status: 409 })
    }
    state.changes++
    const body = JSON.parse(String(init?.body))
    if (body.capability === 'master') data.masterEnabled = body.enabled
    else data.capabilities[body.capability as keyof typeof data.capabilities] = body.enabled
    await new Promise(resolve => setTimeout(resolve, 80))
    return new Response(JSON.stringify({ ok: true }))
  }
  if (url.pathname.endsWith('/test')) { state.trials++; return new Response(JSON.stringify({ text: 'คำตอบทดลองจากผู้ช่วย', charged: true })) }
  if (url.pathname.endsWith('/overview')) {
    const days = Number(url.searchParams.get('days') ?? 7)
    const points = Array.from({ length: days }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 17) - (days - i - 1) * 86400000).toISOString().slice(0, 10), messages: state.empty ? 0 : 10 + i, customers: state.empty ? 0 : 5 + i }))
    const entitlements = state.restriction ? Object.fromEntries(Object.keys(data.entitlements).map(key => [key, { allowed: false, code: state.restriction, message: state.restriction === 'FEATURE_LOCKED' ? 'แพ็กเกจปัจจุบันไม่รองรับความสามารถนี้ กรุณาอัปเกรดแพ็กเกจ' : 'โควตาผู้ช่วย AI หมด กรุณาเพิ่มโควตาก่อนเปิดใช้งาน' }])) : data.entitlements
    return new Response(JSON.stringify({ ...data, entitlements, ready:data.masterEnabled,readiness:data.masterEnabled?[]:['ระบบตอบอัตโนมัติถูกปิดอยู่'], points, recent: state.empty ? [] : data.recent }))
  }
  return new Response(JSON.stringify({ shopInstructions:state.shopInstructions, config: { flags, monthlyLimit: 1000, rateLimit: 10 }, canManage: true, sources: [], versions: [], used: 125, jobs: [], audit: [], customers: [], stats: {}, usage: [] }))
}
Object.assign(window, { agentOverviewTest: state })
createRoot(document.getElementById('root')!).render(<StrictMode><AgentControlCenter tenantId="test-shop" playground={<div>พื้นที่ทดลองเดิม</div>}><div>กฎตอบกลับของร้าน</div></AgentControlCenter></StrictMode>)
