'use client'

// Keep the existing component entry point; all follow-up mutations now use checked APIs.
export {SmartFollowUpsClient as FollowUpsClient} from './SmartFollowUpsClient'
export type {SmartJob as JobRow} from '@/lib/smart-followup-types'
