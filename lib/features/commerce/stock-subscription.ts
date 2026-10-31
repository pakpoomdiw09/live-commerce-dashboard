import type { SupabaseClient } from '@supabase/supabase-js'

export type StockUpdate = {
  products: { id: string; stock: number; commerce_version: number }[]
  variants: { id: string; stock: number }[]
}

/** Incremental stock updates, plus one small snapshot per connection. No polling or aggregate reload. */
export function subscribeCommerceStock(
  db: SupabaseClient,
  tenantId: string,
  ids: string[],
  update: (value: StockUpdate) => void,
) {
  let disposed = false
  let generation = 0
  const controller = new AbortController()
  const seenProducts = new Set<string>(),
    seenVariants = new Set<string>()
  const valid = (row: any) =>
    row?.tenant_id === tenantId && Number.isSafeInteger(row.stock) && row.stock >= 0
  const channel = db
    .channel(`commerce-stock:${tenantId}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'products', filter: `tenant_id=eq.${tenantId}` },
      ({ new: row }) => {
        if (disposed || !valid(row) || !ids.includes(row.id)) return
        seenProducts.add(row.id)
        update({
          products: [{ id: row.id, stock: row.stock, commerce_version: row.commerce_version }],
          variants: [],
        })
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'commerce_variants',
        filter: `tenant_id=eq.${tenantId}`,
      },
      ({ new: row }) => {
        if (disposed || !valid(row) || !ids.includes(row.product_id)) return
        seenVariants.add(row.id)
        update({ products: [], variants: [{ id: row.id, stock: row.stock }] })
      },
    )
  channel.subscribe((status) => {
    if (disposed || status !== 'SUBSCRIBED') return
    const currentGeneration = ++generation
    seenProducts.clear()
    seenVariants.clear()
    void Promise.all([
      db
        .from('products')
        .select('id,stock,commerce_version')
        .eq('tenant_id', tenantId)
        .in('id', ids)
        .abortSignal(controller.signal),
      db
        .from('commerce_variants')
        .select('id,stock')
        .eq('tenant_id', tenantId)
        .in('product_id', ids)
        .abortSignal(controller.signal),
    ])
      .then(([products, variants]) => {
        if (disposed || currentGeneration !== generation) return
        if (products.error || variants.error) {
          console.error('[commerce-stock] snapshot unavailable')
          return
        }
        update({
          products: (products.data ?? []).filter((p) => !seenProducts.has(p.id)),
          variants: (variants.data ?? []).filter((v) => !seenVariants.has(v.id)),
        })
      })
      .catch(() => {
        if (!disposed) console.error('[commerce-stock] connection unavailable')
      })
  })
  return () => {
    disposed = true
    controller.abort()
    void db.removeChannel(channel)
  }
}
