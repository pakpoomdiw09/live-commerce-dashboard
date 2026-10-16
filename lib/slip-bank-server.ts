import 'server-only'
import type {NextRequest} from 'next/server'
import {getActor,canAccessTenant} from './auth'
import {supabaseAdmin} from './supabase/server'
import {InboxError} from './inbox-server'
import {UUID} from './utils'
import generatePayload from 'promptpay-qr'
export async function slipBankTenant(req:NextRequest,tenantId:string,write=false){
 const actor=await getActor(req)
 if(!actor||actor.kind!=='user')throw new InboxError('กรุณาเข้าสู่ระบบ',401)
 if(!UUID.test(tenantId)||!await canAccessTenant(actor,tenantId))throw new InboxError('ไม่พบร้านค้า',404)
 const owner=await canAccessTenant(actor,tenantId,'owner')
 if(write&&!owner)throw new InboxError('เฉพาะเจ้าของร้านเท่านั้น',403)
 return {actor,tenantId,owner,db:supabaseAdmin()}
}
export function bankQr(account:{bank_code:string;account_number:string;is_active:boolean}){
 return account.is_active&&account.bank_code==='PROMPTPAY'&&/^0\d{9}$|^\d{13}$/.test(account.account_number)?generatePayload(account.account_number,{}):null
}
