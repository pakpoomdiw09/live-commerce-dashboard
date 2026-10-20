import {singleFlight} from '@/lib/single-flight'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { runVisionQueue } from '@/lib/features/vision/vision'
export const runtime='nodejs'
export const maxDuration=60
export async function POST(req:NextRequest) {
  const secret=(process.env.CRON_SECRET||process.env.INTERNAL_API_SECRET||'').trim()
  if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'unauthorized'},{status:401})
  try{return NextResponse.json(await singleFlight('cron:vision',()=>runVisionQueue(supabaseAdmin())))}catch{console.error('[vision] worker unavailable');return NextResponse.json({error:'Vision worker unavailable'},{status:503})}
}
