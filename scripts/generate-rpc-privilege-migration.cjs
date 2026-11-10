const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const inventoryPath = path.join(root, 'reports', 'auction-audit', 'rpc-privileges-before-analysis.json')
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
const groupC = new Set([
  'can_access_tenant',
  'can_manage_bank_accounts',
  'can_manage_image_rules',
  'has_tenant_feature',
  'is_platform_admin',
])

const targets = inventory.functions
  .filter((fn) => {
    const name = fn.function_signature.slice(0, fn.function_signature.indexOf('('))
    const acceptsTrustedIdentity = fn.argument_names?.some((arg) => arg === 'p_actor' || arg === 'p_tenant')
    return (fn.is_security_definer || acceptsTrustedIdentity) && !groupC.has(name)
  })
  .sort((a, b) => a.function_signature.localeCompare(b.function_signature))

if (inventory.functions.length !== 314 || targets.length !== 185)
  throw new Error(`Unexpected local RPC inventory: functions=${inventory.functions.length}, targets=${targets.length}`)
if (inventory.functions.some((fn) => fn.owner !== 'postgres'))
  throw new Error('Function owners differ from the reviewed postgres owner role')

const sql = [
  '-- Forward-only RPC execution privilege hardening from the local PGlite catalog audit.',
  '-- This migration changes privileges only. It does not drop or redefine any function.',
  'begin;',
  '',
  'set local lock_timeout = \'2s\';',
  'set local statement_timeout = \'60s\';',
  '',
  '-- The local setup creates these objects as postgres. Prevent PUBLIC/client execution',
  '-- on future functions created by the same migration owner. Function EXECUTE defaults',
  '-- are global, so the role-wide revoke is required; the schema-scoped revoke documents',
  '-- and preserves the intended public-schema boundary.',
  'alter default privileges for role postgres',
  '  revoke execute on functions from public, anon, authenticated;',
  'alter default privileges for role postgres in schema public',
  '  revoke execute on functions from public, anon, authenticated;',
  '',
  '-- Groups A/B/D: explicitly restrict every SECURITY DEFINER function and every',
  '-- function that accepts caller-supplied p_actor or p_tenant identity arguments.',
  ...targets.flatMap((fn) => [
    `revoke all on function public.${fn.function_signature} from public, anon, authenticated;`,
    `grant execute on function public.${fn.function_signature} to service_role;`,
  ]),
  '',
  '-- Group C: these helpers are referenced by authenticated RLS policies and server',
  '-- feature checks. Keep them callable by authenticated and service_role only.',
  'revoke all on function public.can_access_tenant(uuid) from public, anon;',
  'grant execute on function public.can_access_tenant(uuid) to authenticated, service_role;',
  'revoke all on function public.can_manage_bank_accounts(uuid) from public, anon;',
  'grant execute on function public.can_manage_bank_accounts(uuid) to authenticated, service_role;',
  'revoke all on function public.can_manage_image_rules(uuid) from public, anon;',
  'grant execute on function public.can_manage_image_rules(uuid) to authenticated, service_role;',
  'revoke all on function public.has_tenant_feature(uuid, text) from public, anon;',
  'grant execute on function public.has_tenant_feature(uuid, text) to authenticated, service_role;',
  'revoke all on function public.is_platform_admin() from public, anon;',
  'grant execute on function public.is_platform_admin() to authenticated, service_role;',
  '',
  'commit;',
  '',
].join('\n')

const outputPath = path.join(root, 'supabase', 'rpc-execution-hardening.sql')
fs.writeFileSync(outputPath, sql)
process.stdout.write(`Generated ${targets.length} explicit Group A/B/D function grants in ${outputPath}\n`)
