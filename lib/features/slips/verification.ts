import 'server-only'
import { verifyWithZwiz } from './zwiz'
import type { SlipResult, SlipVerificationInput } from './types'

export type { SlipResult, SlipVerdict } from './types'

/** Customer-tab and shared payment flows must use the configured ZWIZ verifier only. */
export async function verifySlip(
  input: SlipVerificationInput,
): Promise<SlipResult> {
  const provider = process.env.SLIP_VERIFICATION_PROVIDER?.trim().toLowerCase() || 'zwiz'
  if (provider !== 'zwiz') {
    console.error('[SLIP_AI_ERROR]', {
      provider,
      stage: 'configuration',
      reason: 'ZWIZ_PROVIDER_NOT_SELECTED',
    })
    return {
      verdict: 'error',
      note: 'ระบบตรวจสลิปสำหรับบิลสะสมยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ',
      providerFault: true,
      raw: null,
    }
  }
  return verifyWithZwiz(input)
}
