import 'server-only'
import type {Actor} from './auth'
import {canAccessTenant} from './auth'
import {supabaseAdmin} from './supabase/server'
import {InboxError} from './inbox-server'
import {UUID} from './utils'
import {overviewFilters,premiumOverviewEnabled,type PremiumOverviewData} from './premium-overview-core'
import {overviewFromTables} from './overview-tables'

export async function loadPremiumOverview(actor:Actor|null,tenantId:string,input:{range?:string|null;page?:string|null;q?:string|null}):Promise<PremiumOverviewData>{
 if(!actor||actor.kind!=='user')throw new InboxError('กรุณาเข้าสู่ระบบ',401)
 if(!UUID.test(tenantId)||!await canAccessTenant(actor,tenantId))throw new InboxError('ไม่พบร้านค้า',404)
 if(!premiumOverviewEnabled())throw new InboxError('ยังไม่เปิด Premium Overview ในสภาพแวดล้อมนี้',403,'FEATURE_DISABLED')
 let filters
 try{filters=overviewFilters(input)}catch{throw new InboxError('ช่วงเวลา หน้า หรือคำค้นไม่ถูกต้อง',400,'INVALID_FILTER')}
 const {summary,notices}=await overviewFromTables(supabaseAdmin(),tenantId,filters)
 if(summary.shop.id!==tenantId)throw new InboxError('ข้อมูลร้านค้าไม่ตรงกัน',503,'OVERVIEW_UNAVAILABLE')
 return {...summary,filters,health:[
  {name:'Slip Verification',status:'unknown',detail:'ยังไม่มี Health Endpoint ของ Provider'},
  {name:'AI Agent',status:'unknown',detail:'ยังไม่ได้ตรวจการเชื่อมต่อ Provider'},
  {name:'Messenger',status:'unknown',detail:'ยังไม่ได้ตรวจการเชื่อมต่อ Meta'},
  {name:'Database',status:notices.length?'unknown':'observed',detail:notices.length?notices.join(' · '):'อ่านข้อมูล Dashboard จากตารางโดยตรงสำเร็จ ณ เวลาอัปเดต'},
  {name:'Credit System',status:summary.metrics.slipCredits===null?'unknown':'observed',detail:summary.metrics.slipCredits===null?'ไม่มีสิทธิ์อ่านเครดิตตรวจสลิป':'อ่านยอดเครดิตจากฐานข้อมูลสำเร็จ'},
  {name:'Broadcast',status:'unknown',detail:'ยังไม่มี Health Endpoint สำหรับการส่ง'},
 ]}
}
