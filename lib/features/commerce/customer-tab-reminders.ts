import 'server-only'
import { GoogleGenAI } from '@google/genai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aiModel } from '@/lib/features/agents/ai-agent'
import { hasFeature } from '@/lib/feature-access'
import { pageTokenFor } from '@/lib/integrations/facebook/client'
import { deliverRichOnce } from '@/lib/features/slips/notify'
import { assertInboxPolicy } from '@/lib/features/inbox/inbox-policy-server'
import { loadCustomerTab, customerTabSummary } from './customer-tabs-server'
import { splitTabMessage } from './customer-tab-types'
import { renderSessionFollowup, validSessionTemplate, type SessionTab } from './live-session-types'

async function reminderGreeting(
  db: SupabaseClient,
  tenantId: string,
  customerId: string,
  key: string,
) {
  const fallback =
    'สวัสดีครับ ทางร้านขออนุญาตแจ้งยอดพระเครื่องที่ยังค้างชำระ หากสะดวกสามารถโอนเพิ่มตามยอดสุทธิด้านล่างได้ครับ'
  if (!process.env.GEMINI_API_KEY?.trim() || !(await hasFeature(db, tenantId, 'ai_agent')))
    return fallback
  if (process.env.AGENT_CONTROL_KILL_SWITCH === 'true') return fallback
  const usage = await db.rpc('start_agent_ai_call', {
    p_tenant: tenantId,
    p_key: key,
    p_customer: customerId,
    p_job: null,
    p_claim: null,
  })
  if (usage.error || !usage.data?.id) return fallback
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      vertexai: false,
      httpOptions: { timeout: 8000, retryOptions: { attempts: 1 } },
    })
    const response = await ai.models.generateContent({
      model: aiModel(),
      contents: 'เขียนคำเกริ่นทักทายเพื่อแจ้งยอดค้างร้านพระเครื่องอย่างสุภาพ ไม่กดดันลูกค้า',
      config: {
        maxOutputTokens: 180,
        responseMimeType: 'application/json',
        systemInstruction:
          'Return JSON {greeting:string}. One short friendly Thai paragraph, at most 240 characters. No numbers, amounts, URLs, account details, claims of payment, urgency, discounts or promises. The application appends the verified ledger separately.',
      },
    })
    const value = JSON.parse(response.text ?? '{}') as { greeting?: unknown }
    const greeting = typeof value.greeting === 'string' ? value.greeting.trim() : ''
    const saved = await db
      .from('agent_ai_usage')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        input_tokens: response.usageMetadata?.promptTokenCount ?? null,
        output_tokens: response.usageMetadata?.candidatesTokenCount ?? null,
        reason: 'CUSTOMER_TAB_REMINDER',
      })
      .eq('id', usage.data.id)
      .eq('tenant_id', tenantId)
    if (saved.error) return fallback
    return greeting.length > 0 &&
      greeting.length <= 240 &&
      !/[0-9๐-๙]|https?:|www\.|บาท|บัญชี|ชำระครบ|โอนแล้ว/u.test(greeting)
      ? greeting
      : fallback
  } catch {
    await db
      .from('agent_ai_usage')
      .update({
        status: 'provider_error',
        completed_at: new Date().toISOString(),
        reason: 'TAB_REMINDER_WORDING_FAILED',
      })
      .eq('id', usage.data.id)
      .eq('tenant_id', tenantId)
    return fallback
  }
}

/** Current ledger is re-read after AI generation. Each send has a durable message key. */
export async function runCustomerTabReminders(db: SupabaseClient, deadline = Date.now() + 40_000) {
  const result = { sent: 0, blocked: 0, cancelled: 0, review: 0 }
  if (process.env.AGENT_CONTROL_KILL_SWITCH === 'true') return result
  for (let count = 0; count < 10 && Date.now() < deadline; count++) {
    const claimed = await db.rpc('claim_customer_tab_reminder')
    if (claimed.error) throw claimed.error
    const job = claimed.data?.[0] as
      | {
          id: string
          tab_id: string
          claim_token: string
          message_template?: string | null
          send_after?: string | null
        }
      | undefined
    if (!job) break
    let customerId: string | null = null
    let deliveryStarted = false
    const finish = async (status: string, errorCode?: string) => {
      const saved = await db
        .from('customer_tab_reminders')
        .update({ status, completed_at: new Date().toISOString(), error_code: errorCode ?? null })
        .eq('id', job.id)
        .eq('claim_token', job.claim_token)
        .eq('status', 'processing')
      if (saved.error) throw saved.error
    }
    try {
      if (job.send_after) {
        const delay = Math.max(0, Date.parse(job.send_after) - Date.now())
        if (!Number.isFinite(delay) || delay > 5500) throw new Error('TAB_DISPATCH_SLOT_INVALID')
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      }
      let tab = await loadCustomerTab(db, job.tab_id)
      if (!tab || Number(tab.remaining_amount) <= 0) {
        await finish('cancelled')
        result.cancelled++
        continue
      }
      customerId = tab.customer_id
      const [customer, tenant] = await Promise.all([
        db
          .from('customers')
          .select('id,platform_user_id,display_name,bot_enabled,agent_opted_out')
          .eq('id', tab.customer_id)
          .eq('tenant_id', tab.tenant_id)
          .single(),
        db
          .from('tenants')
          .select('page_id,page_access_token,auto_reply_enabled')
          .eq('id', tab.tenant_id)
          .eq('page_id', tab.page_id)
          .eq('is_active', true)
          .single(),
      ])
      if (customer.error || tenant.error) throw new Error('TAB_REMINDER_SCOPE')
      if (
        !customer.data.bot_enabled ||
        customer.data.agent_opted_out ||
        !tenant.data.auto_reply_enabled
      ) {
        await finish('blocked', 'AUTOMATION_PAUSED')
        result.blocked++
        continue
      }
      const token = pageTokenFor(tenant.data)
      if (!token) throw new Error('PAGE_NOT_READY')
      // Automated reminders never use HUMAN_AGENT or another exception outside the normal window.
      await assertInboxPolicy(db, tab.tenant_id, tab.customer_id, tab.page_id, token, false)
      const greeting = job.message_template
        ? undefined
        : await reminderGreeting(db, tab.tenant_id, tab.customer_id, job.id)
      tab = await loadCustomerTab(db, job.tab_id, tab.tenant_id)
      if (!tab || Number(tab.remaining_amount) <= 0) {
        await finish('cancelled')
        result.cancelled++
        continue
      }
      const summary = await customerTabSummary(db, tab, greeting)
      let text = summary.text
      if (job.message_template) {
        if (!validSessionTemplate(job.message_template)) throw new Error('TAB_TEMPLATE_INVALID')
        const preview: SessionTab = {
          id: tab.id,
          customerId: tab.customer_id,
          name: customer.data.display_name || customer.data.platform_user_id,
          total: tab.total_amount,
          paid: tab.paid_amount,
          remaining: tab.remaining_amount,
          credit: tab.credit_amount,
          shipping: tab.shipping_fee,
          revision: tab.revision,
          slips: tab.customer_tab_payments.length,
          canMessage: true,
          lastReminder: null,
          items: tab.customer_tab_items
            .filter((item) => !item.cancelled)
            .map((item) => ({ orderId: item.order_id, name: item.item_name, amount: item.amount })),
        }
        text = `${renderSessionFollowup(job.message_template, preview)}\n\n${summary.text}`
      }
      const parts: object[] = splitTabMessage(text).map((part) => ({ text: part }))
      parts.push({
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: 'ดูรายการทั้งหมด ยอดคงเหลือ เลขบัญชี/QR และแนบสลิปได้ที่นี่ครับ',
            buttons: [{ type: 'web_url', title: 'ดูบิล / แนบสลิป', url: summary.link }],
          },
        },
      })
      deliveryStarted = true
      const sent = await deliverRichOnce(
        db,
        { id: tab.customer_id, psid: customer.data.platform_user_id, token },
        `tab-reminder:${job.id}`,
        text,
        parts,
      )
      if (!sent) {
        const existing = await db
          .from('messages')
          .select('delivery_status')
          .eq('customer_id', tab.customer_id)
          .eq('external_id', `tab-reminder:${job.id}`)
          .maybeSingle()
        if (
          existing.error ||
          !['sent', 'delivered', 'read'].includes(existing.data?.delivery_status ?? '')
        )
          throw new Error('TAB_SEND_UNCONFIRMED')
      }
      await finish('sent')
      result.sent++
      console.info('[customer-tabs/reminder] sent', { jobId: job.id, tabId: tab.id })
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      const state = deliveryStarted ? 'requires_review' : 'blocked'
      await finish(
        state,
        code && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'TAB_REMINDER_UNAVAILABLE',
      )
      if (state === 'requires_review') result.review++
      else result.blocked++
      console.warn('[customer-tabs/reminder] held', { jobId: job.id, customerId, state })
    }
  }
  return result
}
