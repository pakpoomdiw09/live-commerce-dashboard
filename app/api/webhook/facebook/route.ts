import { getFacebookWebhook, postFacebookWebhook } from '@/lib/integrations/facebook/webhook-http'

export const runtime = 'nodejs'
export const maxDuration = 300

export const GET = getFacebookWebhook
export const POST = postFacebookWebhook
