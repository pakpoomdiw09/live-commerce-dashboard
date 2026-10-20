import 'server-only'
import type {NextRequest} from 'next/server'
import {slipBankTenant} from '@/lib/features/slips/slip-bank-server'
import {hasFeature} from '@/lib/feature-access'
import {InboxError} from '@/lib/features/inbox/inbox-server'
import {validateVisionFile} from '@/lib/features/vision/vision-image'
import sharp from 'sharp'
import jsQR from 'jsqr'
import generatePayload from 'promptpay-qr'
import {codeMatchesAccount,type ReceivingAccount} from '@/lib/features/payments/payment-codes-core'

export const paymentCodesEnabled=()=>process.env.PAYMENT_CHANNELS_ENABLED==='true'
export async function receivingCodeTenant(req:NextRequest,tenantId:string){
 const scope=await slipBankTenant(req,tenantId,true)
 if(!paymentCodesEnabled())throw new InboxError('ระบบจัดการ QR รับเงินยังไม่เปิดใช้งาน',409,'FEATURE_DISABLED')
 if(!await hasFeature(scope.db,tenantId,'slip_auto_pilot'))throw new InboxError('แพ็กเกจไม่รองรับระบบรับเงินและตรวจสลิป',403,'FEATURE_LOCKED')
 return scope
}
export function createReceivingQr(account:ReceivingAccount,amountSatang:number|null){
 if(amountSatang!==null&&(!Number.isSafeInteger(amountSatang)||amountSatang<=0||amountSatang>9999999999))throw new InboxError('ยอดเงินไม่ถูกต้อง')
 const payload=generatePayload(account.account_number,amountSatang===null?{}:{amount:amountSatang/100})
 codeMatchesAccount(payload,account)
 return payload
}
/** Decode raster locally, bound decompression, reject SVG and never fetch arbitrary URLs. */
export async function decodeReceivingQr(file:File){
 const bytes=await validateVisionFile(file)
 const {data,info}=await sharp(bytes,{limitInputPixels:16000000,animated:false}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 const result=jsQR(new Uint8ClampedArray(data),info.width,info.height,{inversionAttempts:'attemptBoth'})
 if(!result?.data)throw new InboxError('อ่าน QR ไม่ได้ กรุณาใช้รูป PNG/JPG/WebP ที่ชัดเจน')
 return result.data
}
