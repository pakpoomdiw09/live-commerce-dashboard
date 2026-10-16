# Database-only platform administrators

Run `platform-admin-db-only.sql` after the installed dashboard and feature-bypass migrations, then deploy the application. It replaces permission functions without changing admin memberships, tenant ownership, balances, or settings. Future reruns of the updated source migrations retain database-only checks.

`public.platform_admins` is the exclusive source of platform-administrator status. `tenant_members.role` remains the source of tenant owner/staff permissions. Email, UUID literals and either form of auth metadata do not grant platform access. Internal service credentials remain server-to-server credentials and are not user roles.

Before rollout, check that the intended administrators have explicit rows in `platform_admins`. Users who previously relied solely on app metadata lose platform privileges; this migration deliberately does not promote them automatically. It also does not remove any existing administrator row based on someone's email. Remove unwanted rows explicitly through trusted database administration.
