export type FeatureName = 'sales_page_v2'

/** Public flags are configuration, not authorization. Only the literal "true" enables a feature.
 * Explicit public values take precedence; old server flags remain a migration fallback.
 * Keep public env references static so Next.js can inline them in browser bundles.
 */
export function isFeatureEnabled(feature: FeatureName): boolean {
  switch (feature) {
    case 'sales_page_v2':
      return (
        (process.env.NEXT_PUBLIC_SALES_PAGE_V2_ENABLED ?? process.env.SALES_PAGE_V2_ENABLED) ===
        'true'
      )
    default:
      return false
  }
}
