import 'server-only'
import { after, NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { parseWebhook, readWebhookBody, verifyWebhookSignature, WebhookInputError } from '@/lib/integrations/facebook/webhook-envelope'
import { runFacebookWebhookWorker } from '@/lib/integrations/facebook/webhook-worker'
import { handleFacebookWebhookEvent } from '@/lib/integrations/facebook/webhook-handler'

// All ingress requests in this process share one drain. Database leases still
// fence independent cron workers / other server instances.
let activeDrain:Promise<unknown>|null=null
let drainRequested=false

export function getFacebookWebhook(req: NextRequest) {
  const query = req.nextUrl.searchParams
  const token = process.env.FB_VERIFY_TOKEN?.trim() || process.env.FACEBOOK_VERIFY_TOKEN?.trim()
  const challenge = query.get('hub.challenge')
  const mode = query.get('hub.mode')
  const verifyToken = query.get('hub.verify_token')
  if (process.env.FB_DEBUG === 'true') {
    console.log('[facebook-webhook/verify] verification request', { mode, verifyTokenMatches: Boolean(token && verifyToken === token), hasChallenge: Boolean(challenge) })
  }
  if (token && challenge && mode === 'subscribe' && verifyToken === token) {
    return new NextResponse(challenge, { headers: { 'Content-Type': 'text/plain' } })
  }
  console.log('[WEBHOOK DROP] เหตุผล:',{reason:'VERIFY_TOKEN_OR_CHALLENGE_INVALID',status:403})
  return new NextResponse('Forbidden', { status: 403 })
}

export async function postFacebookWebhook(req: NextRequest) {
  try {
    // Keep the original bytes for signature verification; never reserialize the
    // parsed body before checking Meta's signature.
    const bytes = await readWebhookBody(req)
    let body:Record<string,any>|undefined
    try{
      body=JSON.parse(bytes.toString('utf8'))
      console.log('[WEBHOOK RECEIVER] Payload:',JSON.stringify(body))
    }catch{console.log('[WEBHOOK DROP] เหตุผล:',{reason:'PAYLOAD_NOT_JSON',bytes:bytes.length})}
    const secret = process.env.FB_APP_SECRET?.trim()
    if (!secret) {
      console.log('[WEBHOOK DROP] เหตุผล:',{reason:'MISSING_APP_SECRET',status:503})
      console.error('[facebook-webhook/ingress] missing FB_APP_SECRET')
      return new NextResponse('Webhook unavailable', { status: 503, headers: { 'Retry-After': '30' } })
    }
    const signature = req.headers.get('x-hub-signature-256')
    if (!verifyWebhookSignature(bytes, signature, secret)) {
      console.log('[WEBHOOK DROP] เหตุผล:',{reason:'SIGNATURE_INVALID',status:401,hasSignature:Boolean(signature)})
      console.warn('[facebook-webhook/ingress] signature verification failed', { hasSignature: Boolean(signature) })
      return new NextResponse('Invalid signature', { status: 401 })
    }
    const envelope = parseWebhook(bytes)
    console.log('[facebook-webhook/ingress] verified payload', {
      hash:envelope.hash.slice(0,12),bytes:bytes.length,eventCount:envelope.events.length,
      events:envelope.events.slice(0,10).map(e=>({pageId:e.pageId,kind:e.kind,eventKey:e.eventKey.slice(0,12),
        messageId:e.payload.message?.mid??null,echo:e.payload.message?.is_echo===true,
        textLength:typeof e.payload.message?.text==='string'?e.payload.message.text.length:0,
        attachments:Array.isArray(e.payload.message?.attachments)?e.payload.message.attachments.length:0,
        fields:Object.keys(e.payload).slice(0,12)})),
    })
    if (process.env.FB_DEBUG === 'true') {
      console.log('[facebook-webhook/ingress] payload accepted', { eventCount: envelope.events.length, hash: envelope.hash.slice(0, 12) })
    }
    const db = supabaseAdmin({timeoutMs:10000})
    const started=Date.now()
    console.log('[facebook-webhook/ingress] enqueue started',{hash:envelope.hash.slice(0,12)})
    const saved = await db.rpc('enqueue_facebook_webhook', { p_raw: envelope.raw, p_hash: envelope.hash, p_events: envelope.events })
    if (saved.error || !saved.data?.id || !Number.isInteger(saved.data.accepted) || saved.data.accepted<0 || saved.data.accepted>envelope.events.length) {
      console.log('[WEBHOOK DROP] เหตุผล:',{reason:saved.error?'QUEUE_INSERT_FAILED':'QUEUE_RECEIPT_INVALID',status:503,
        rpc:'enqueue_facebook_webhook',error:saved.error?{code:saved.error.code,message:saved.error.message,details:saved.error.details,hint:saved.error.hint}:null,
        receipt:saved.error?undefined:saved.data,elapsedMs:Date.now()-started})
      console.error('[facebook-webhook/ingress] persistence unavailable', { code: saved.error?.code ?? 'INVALID_RECEIPT',elapsedMs:Date.now()-started,hash:envelope.hash.slice(0,12) })
      return new NextResponse('Webhook persistence unavailable', { status: 503, headers: { 'Retry-After': '30' } })
    }
    console.log('[facebook-webhook/ingress] queued', { receiptId: saved.data.id, eventCount: envelope.events.length, accepted: saved.data.accepted,duplicates:envelope.events.length-saved.data.accepted,elapsedMs:Date.now()-started })
    if (!envelope.events.length) console.log('[WEBHOOK DROP] เหตุผล:',{reason:'NO_EVENTS_IN_MESSAGING_OR_CHANGES',receiptId:saved.data.id,
      entryFields:Array.isArray(body?.entry)?body.entry.slice(0,10).map((entry:unknown)=>entry&&typeof entry==='object'?Object.keys(entry):[]):[],
      note:'Payload receipt is stored, but no event rows were supplied to the queue'})
    else if(saved.data.accepted===0)console.log('[WEBHOOK DROP] เหตุผล:',{reason:'ALL_EVENTS_ALREADY_QUEUED',receiptId:saved.data.id,eventCount:envelope.events.length,note:'Existing queue rows are retained; duplicate delivery does not create new events'})
    // Drain immediately when possible; the scheduled worker also handles restarts.
    try {
      after(async () => {
        drainRequested=true
        if(activeDrain){await activeDrain.catch(()=>{});return}
        // A new receipt may commit after the active worker's final empty claim.
        // Coalesce one more drain instead of losing that wakeup until cron runs.
        const drain=(async()=>{
          for(let pass=0;pass<3&&drainRequested;pass++){
            drainRequested=false
            const result=await runFacebookWebhookWorker(db,handleFacebookWebhookEvent)
            console.log('[facebook-webhook/worker] drain complete',result)
            if(result?.claimed===0)console.warn('[facebook-webhook/worker] no claimable events',{receiptId:saved.data.id,hint:'Check event status/available_at/lease_until and older requires_review/dead blockers; claimed=0 does not mean enqueue failed'})
          }
        })()
        activeDrain=drain
        try { await drain }
        catch (workerErr) { console.error('[facebook-webhook/worker] deferred drain error', workerErr) }
        finally{if(activeDrain===drain)activeDrain=null}
      })
    } catch { console.error('[facebook-webhook/worker] deferred scheduling unavailable') }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WebhookInputError) {
      console.log('[WEBHOOK DROP] เหตุผล:',{reason:'INPUT_VALIDATION_FAILED',message:error.message,status:error.status})
      console.warn('[facebook-webhook/ingress] input validation error', { message: error.message, status: error.status })
      return new NextResponse(error.message, { status: error.status })
    }
    console.log('[WEBHOOK DROP] เหตุผล:',{reason:'RECEIVER_EXCEPTION',status:503,error})
    console.error('[facebook-webhook/ingress] request unexpected error', error)
    return new NextResponse('Webhook unavailable', { status: 503, headers: { 'Retry-After': '30' } })
  }
}
