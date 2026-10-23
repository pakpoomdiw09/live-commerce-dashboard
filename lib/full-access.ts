/** Temporary owner-requested package bypass. Apply supabase/full-access.sql as well.
 * Restore package enforcement by reverting this flag and running full-access-rollback.sql.
 * Authentication, tenant membership, provider limits and emergency stops still apply.
 */
export const temporaryFullAccess = true
