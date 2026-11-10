const fs = require('node:fs')
const path = require('node:path')
const { fixture } = require('./helpers/auction-hardening-db.cjs')

const mode = process.argv[2]
if (mode !== 'after')
  throw new Error('This utility captures the current post-migration registry only: node scripts/capture-rpc-privileges.cjs after')

async function main() {
  const f = await fixture()
  try {
    const schemaRoles = await f.db.query(`
      select role_name,
        pg_catalog.has_schema_privilege(role_name, 'public', 'USAGE') as public_usage
      from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
      order by role_name
    `)
    if (schemaRoles.rows.some((row) => row.public_usage !== true))
      throw new Error(`Role bootstrap incomplete: ${JSON.stringify(schemaRoles.rows)}`)

    const registry = await f.db.query(`
      SELECT
        p.oid::regprocedure AS function_signature,
        p.prosecdef AS is_security_definer,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      ORDER BY p.proname, function_signature
    `)

    const metadata = await f.db.query(`
      SELECT
        p.oid::regprocedure::text AS function_signature,
        p.proargnames AS argument_names,
        pg_get_function_arguments(p.oid) AS arguments,
        pg_get_userbyid(p.proowner) AS owner,
        p.prokind AS kind,
        p.prosecdef AS is_security_definer,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec,
        COALESCE(array_agg(t.tgname) FILTER (WHERE t.tgname IS NOT NULL), ARRAY[]::name[]) AS triggers
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_trigger t ON t.tgfoid = p.oid AND NOT t.tgisinternal
      WHERE n.nspname = 'public'
      GROUP BY p.oid
      ORDER BY p.proname, function_signature
    `)
    const defaults = await f.db.query(`
      SELECT current_user AS session_user,
        r.rolname AS owner_role,
        n.nspname AS schema_name,
        d.defaclobjtype AS object_type,
        d.defaclacl::text AS default_acl
      FROM pg_default_acl d
      JOIN pg_roles r ON r.oid = d.defaclrole
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE n.nspname = 'public'
      ORDER BY r.rolname, d.defaclobjtype
    `)
    const policies = await f.db.query(`
      SELECT tablename, policyname, cmd, roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `)
    const dependencyAudit = await f.db.query(`
      WITH group_c(proname) AS (VALUES
        ('can_access_tenant'), ('can_manage_bank_accounts'), ('can_manage_image_rules'),
        ('has_tenant_feature'), ('is_platform_admin')
      ), targets AS (
        SELECT p.oid, p.proname, p.oid::regprocedure::text AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname NOT IN (SELECT proname FROM group_c)
          AND (p.prosecdef OR p.proargnames && ARRAY['p_actor', 'p_tenant']::text[])
      ), policy_refs AS (
        SELECT t.signature AS target_signature, p.tablename, p.policyname, p.cmd,
          concat_ws(' ', p.qual, p.with_check) AS expression
        FROM targets t
        JOIN pg_policies p ON p.schemaname = 'public'
        WHERE position(t.proname in concat_ws(' ', p.qual, p.with_check)) > 0
      ), invoker_refs AS (
        SELECT t.signature AS target_signature, c.oid::regprocedure::text AS caller_signature,
          c.prosecdef AS caller_security_definer,
          has_function_privilege('anon', c.oid, 'EXECUTE') AS caller_anon_exec,
          has_function_privilege('authenticated', c.oid, 'EXECUTE') AS caller_auth_exec,
          c.prorettype::regtype::text AS caller_return_type
        FROM targets t
        JOIN pg_proc c ON c.oid <> t.oid AND NOT c.prosecdef
        JOIN pg_namespace n ON n.oid = c.pronamespace AND n.nspname = 'public'
        WHERE c.prosrc ~ ('(^|[^[:alnum:]_])' || t.proname || '([^[:alnum:]_]|$)')
          AND (has_function_privilege('authenticated', c.oid, 'EXECUTE')
            OR EXISTS (SELECT 1 FROM pg_trigger tr WHERE tr.tgfoid = c.oid AND NOT tr.tgisinternal))
      )
      SELECT 'policy'::text AS ref_kind, target_signature, tablename || '.' || policyname AS reference,
        cmd::text AS detail
      FROM policy_refs
      UNION ALL
      SELECT 'invoker_function', target_signature, caller_signature AS reference,
        'return=' || caller_return_type || ', anon_exec=' || caller_anon_exec || ', auth_exec=' || caller_auth_exec
      FROM invoker_refs
      ORDER BY ref_kind, target_signature, reference
    `)

    const outputDir = path.join(__dirname, '..', 'reports', 'auction-audit', 'rpc-privileges')
    fs.mkdirSync(outputDir, { recursive: true })
    const output = path.join(outputDir, `${mode}.json`)
    fs.writeFileSync(output, `${JSON.stringify(registry.rows, null, 2)}\n`)
    const analysisOutput = path.join(outputDir, `${mode}-analysis.json`)
    fs.writeFileSync(analysisOutput, `${JSON.stringify({ functions: metadata.rows, default_privileges: defaults.rows, policies: policies.rows, dependency_audit: dependencyAudit.rows }, null, 2)}\n`)
    process.stdout.write(JSON.stringify({
      mode,
      role_bootstrap: schemaRoles.rows,
      function_count: registry.rows.length,
      security_definer_count: registry.rows.filter((row) => row.is_security_definer).length,
      functions_executable_by_anon: registry.rows.filter((row) => row.anon_exec).length,
      functions_executable_by_authenticated: registry.rows.filter((row) => row.auth_exec).length,
      output,
      analysis_output: analysisOutput,
      current_role: (await f.db.query('select current_user')).rows[0].current_user,
    }, null, 2) + '\n')
  } finally {
    await f.db.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
