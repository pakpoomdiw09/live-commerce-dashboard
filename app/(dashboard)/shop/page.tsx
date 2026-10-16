import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/tenant'
import { PRODUCT_COLUMNS, type ProductRow } from '@/lib/types'
import { ShopClient, type ShopOrder } from '@/components/shop/ShopClient'
import { LiveRefresh } from '@/components/LiveRefresh'
import { SetupNotice } from '@/components/SetupNotice'

export const metadata = { title: 'ร้านค้า / เซลเพจ' }

export default async function ShopPage() {
  const [db, tenant] = await Promise.all([supabaseServer(), getActiveTenant()])
  if (!tenant) return <SetupNotice kind="no-tenant" />

  const [products, orders] = await Promise.all([
    db.from('products').select(PRODUCT_COLUMNS).eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
    db
      .from('orders')
      .select('id, customer_id, product_name, amount, status, paid_at, confirmed_at, created_at, customers(display_name, platform_user_id)')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  const error = products.error ?? orders.error
  if (error) return <SetupNotice kind="migration" message={error.message} />

  return (
    <>
      {/* CF orders take stock in the webhook: keep the numbers live */}
      <LiveRefresh channel="shop" tables={['products', 'orders']} />
      <ShopClient
        tenantId={tenant.id}
        pageLinked={!!tenant.page_id}
        products={((products.data ?? []) as ProductRow[]).map((p) => ({ ...p, price: Number(p.price) }))}
        orders={((orders.data ?? []) as unknown as ShopOrder[]).map((o) => ({ ...o, amount: Number(o.amount) }))}
      />
    </>
  )
}
