/**
 * Temporary project-wide pause. Shared by client navigation and server entry points.
 * Set to true and redeploy to restore the original feature without changing stored settings/jobs.
 * Also uncomment the schedule in .github/workflows/cron.yml to resume scheduled runs.
 */
export const SMART_FOLLOW_UP_ENABLED: boolean = false
export const FOLLOW_UPS_PAUSED_MESSAGE = 'ผู้ช่วยติดตามลูกค้าปิดให้บริการชั่วคราว'
