import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreRulesSettings } from '../../components/chatbot/StoreRulesSettings'
import { StoreRulesErrorBoundary } from '../../components/chatbot/StoreRulesErrorBoundary'
import { parseStoreRules } from '../../lib/features/store-rules/store-rule-items'

const original = '{"snapbot_store_rules":1,"rules":null,"note":"<script>window.rulesInjected=true</script>"}'
const state = { original, raw: original, writes: 0, backup: '', reload: async () => {}, failRender: () => {}, recoverRender: () => {} }
Object.assign(window, { storeRulesRecoveryTest: state })
const createUrl = URL.createObjectURL.bind(URL)
URL.createObjectURL = blob => { if (blob instanceof Blob) void blob.text().then(text => { state.backup = text }); return createUrl(blob) }
document.addEventListener('click', event => { if (event.target instanceof HTMLAnchorElement && event.target.download) event.preventDefault() })
window.fetch = async (_url, init) => {
  const value = JSON.parse(String(init?.body))
  if (value.expectedInstructions !== state.raw) return new Response(JSON.stringify({ error: 'กฎของร้านมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่ก่อนบันทึก' }), { status: 409 })
  if (value.recover !== true || !parseStoreRules(value.instructions).ok) throw Error('Invalid recovery request')
  state.raw = value.instructions; state.writes++
  return new Response(JSON.stringify({ ok: true, instructions: state.raw }))
}
function Child({ fail }: { fail: boolean }) { if (fail) throw Error('StoreRulesBoundaryTestFault'); return <p id="healthy-child">แสดงกฎได้ตามปกติ</p> }
function App() {
  const [raw, setRaw] = useState(state.raw), [fault, setFault] = useState(false)
  state.reload = async () => { setRaw(state.raw) }
  state.failRender = () => setFault(true); state.recoverRender = () => setFault(false)
  return <main className="mx-auto min-w-0 max-w-6xl space-y-5 p-4"><h1 className="text-2xl font-bold">แดชบอร์ดยังใช้งานได้</h1>
    <StoreRulesSettings tenantId="test-tenant" initial={raw} onSaved={state.reload} disabled={false}/>
    <StoreRulesErrorBoundary resetKey={String(fault)} fallback={<p id="boundary-fallback" role="alert">แสดงกฎไม่สำเร็จ ส่วนอื่นยังใช้งานได้</p>}><Child fail={fault}/></StoreRulesErrorBoundary>
  </main>
}
createRoot(document.getElementById('root')!).render(<App/> )
