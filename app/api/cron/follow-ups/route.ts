import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runFollowUps } from '@/lib/follow-ups'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Payment reminder worker for every tenant. Call it every minute from a scheduler:
 * Supabase pg_cron (see supabase/automation.sql), Vercel Cron, or any uptime pinger.
 * Authorization: Bearer <CRON_SECRET>, or INTERNAL_API_SECRET when CRON_SECRET is not set.
 */
async function handle(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '').trim()
  // an unset secret must never let anyone in (fail closed)
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runFollowUps(supabaseAdmin()))
  } catch (e) {
    console.error('[cron follow-ups]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
