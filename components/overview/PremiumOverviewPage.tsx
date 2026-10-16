import {getActor,requireDashboardUser} from '@/lib/auth'
import {getActiveTenant,getTenants} from '@/lib/tenant'
import {SetupNotice} from '@/components/SetupNotice'
import {loadPremiumOverview} from '@/lib/premium-overview-server'
import {PremiumOverview} from './PremiumOverview'
import {InlineError} from '@/components/ErrorState'
import Link from 'next/link'
import {ActionRequired} from './ActionRequired'
import {BasicOverviewPage} from './BasicOverviewPage'
export async function PremiumOverviewPage({filters}:{filters:{range?:string;page?:string;q?:string}}){
 const user=await requireDashboardUser()
 const {error:tenantError}=await getTenants()
 if(tenantError)return <div className="p-6"><InlineError title="โหลดข้อมูลร้านค้าไม่ได้" message={tenantError}/></div>
 const tenant=await getActiveTenant()
 if(!tenant)return <SetupNotice kind="no-tenant"/>
 try{
  const [data,shops]=await Promise.all([loadPremiumOverview(await getActor(),tenant.id,filters),getTenants()])
  return <><div className="p-4 md:px-8"><ActionRequired tenant={tenant}/></div><PremiumOverview key={`${tenant.id}:${data.filters.range}:${data.filters.page}:${data.filters.q}`} data={data} shopCount={shops.tenants.length} userName={user.email??'สมาชิก SnapBot'}/></>
 }catch(error){return <><div className="space-y-4 p-6"><InlineError title="ภาพรวมขั้นสูงไม่พร้อมใช้งาน กำลังแสดงข้อมูลสรุปพื้นฐาน" message={error instanceof Error?error.message:'กรุณาลองใหม่'}/><Link href="/overview?view=basic" className="text-orange-700 underline">เปิดภาพรวมพื้นฐาน</Link></div><BasicOverviewPage/></>}
}
