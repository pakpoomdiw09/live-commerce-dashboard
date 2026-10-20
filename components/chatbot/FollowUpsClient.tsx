'use client'

// Keep the existing component entry point; all follow-up mutations now use checked APIs.
export {SmartFollowUpsClient as FollowUpsClient} from '@/components/chatbot/SmartFollowUpsClient'
export type {SmartJob as JobRow} from '@/lib/features/follow-ups/smart-followup-types'
