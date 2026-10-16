# Supported bank selection

The selector now uses `SUPPORTED_BANKS` from `lib/banks.ts`: the 18 institutions in https://slipok.com/api-documentation/bank-code/ (checked 2026-10-16).

The full 36-entry registry, aliases, assets, database constraints and existing account rows are preserved. PromptPay is a payment channel outside this list and is no longer offered for new bank selections. Existing QR data and rendering remain available.

Account save and tenant creation reject unsupported banks. Account activation and primary selection validate the stored bank with a tenant-scoped lookup. Disabling an existing unsupported account is allowed. Enabling Auto-Verify requires at least one active account and rejects any active account outside the supported list; database read failures also block enabling it. Existing automation settings are not rewritten.

No database migration is needed. This policy is enforced in the application API; existing database RPC allow-lists remain unchanged for historical compatibility.

Validation:

- `npx.cmd tsc --noEmit`
- `npm.cmd run build`
- `node --test scripts/test-*.cjs`
- `node scripts/check-bank-selector-browser.cjs`

Focused tests: `test-bank-registry.cjs`, `test-slip-single-page.cjs`, `test-slip-settings.cjs`, and `test-supported-bank-guard.cjs`.

Final results: TypeScript and production build passed (existing lint warnings remain). Focused tests passed 20/20. Full regression passed 316/319 with the three failures below. Offline Chrome checks passed all 18 selectable banks, unsupported search exclusion, keyboard navigation, account add/edit, local logos, and 375/768/1440px layouts.

Changed files:

- `lib/banks.ts`, `lib/bank-accounts.ts`, `lib/validation.ts`
- `components/BankSelector.tsx`, `components/settings/BankAccountsManager.tsx`
- `app/api/bank-accounts/route.ts`, `app/api/tenants/[id]/route.ts`
- `scripts/test-bank-registry.cjs`, `scripts/test-slip-single-page.cjs`, `scripts/test-supported-bank-guard.cjs`
- `scripts/check-bank-selector-browser.cjs`, `scripts/fixtures/bank-selector-entry.tsx`
- This document and regenerated `docs/screenshots/bank-selector-{375,768,1440}.png`

The existing full-suite failures outside bank selection are `test-admin-feature-bypass.cjs` (fixture tenant table lacks `is_active`) and two scenarios in `test-dashboard-page-scope.cjs` (VM context lacks `process`). These also fail when run separately.

This policy supersedes the selection and account-save behavior described in BANK-REGISTRY.md; the full historical registry and SQL compatibility described there still apply.
