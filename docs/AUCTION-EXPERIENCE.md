# Live Auction setup and Inbox integration

`/live-cf?mode=auction` uses the same Page/video picker, template editor, switches and receiving-bank selector as CF. The video list uses the existing authenticated `/api/facebook/live-videos` endpoint. A single on-air video can be selected automatically; recordings and multiple concurrent streams require an explicit selection. Switching the Page clears the previous video. The raw URL input remains available as an advanced option in CF.

## Upgrade and deployment

1. Apply `supabase/auction-experience.sql` **after** `supabase/customer-tabs.sql` and its dependencies. For a new database, the generated `supabase/complete_schema.sql` includes the upgrade. Do not rerun historical migrations after this upgrade: they can replace newer function definitions.
2. Set `LIVE_CF_APP_URL` to the public HTTPS origin and `LIVE_CF_PAYMENT_LINK_SECRET` to a persistent signing secret. Keep existing Supabase, Facebook Page and SlipOK credentials configured. Tokens stay on the server.
3. Deploy the application. Existing rounds default to enabled public/private replies; new rounds save the switches and all three templates. The receiving account remains required for the ledger even if private replies are disabled. An existing cumulative tab retains its original receiving account; its rendered bill is authoritative.
4. Open `/live-cf?mode=auction`, choose the Page/live and bank, edit templates, and open a round. Close with the host ❌ button or a verified host comment. Use **จบไลฟ์และตั้งทวงยอด** after the live ends to record the session end and queue reminders. Closing one item does not end the whole live.

The existing ledger attaches CF and auction wins in one database transaction and charges shipping once per customer/live. The close transaction now also reopens the local conversation, inserts a win activity and a pending bill, and creates the configured notification outbox entries. Disabling both reply switches still records the sale and local Inbox activity. Replaying a close cannot duplicate these records.

The win activity has no Messenger delivery status. It does not alter the last inbound message, inbound sequence or messaging window. The private bill changes from `pending` to `sent` only after a provider receipt. A timeout or expired dispatch lease requires review and is not automatically resent. The bill uses a single comment-addressed button template with a signed payment/slip URL; a definitive unsupported-template response may fall back to a text bill with the same link. Long bills use a compact financial summary and put the full item list on the signed page.

Smart Inbox polls the status of loaded customers every five seconds and displays the latest auction item with the current tab balance. The existing side panel lists all items, verified payments and slips. **ส่งข้อความทวงยอด** queues a reminder for that customer, using the existing policy checks and authoritative balance renderer.

## Scheduled reminders

`end_customer_tab_live` schedules unpaid tabs for one hour after the recorded end and the following **09:00 Asia/Bangkok**. The protected `GET/POST /api/cron/customer-tabs` worker dispatches due jobs. The Facebook webhook recovery worker also drains them.

For GitHub Actions scheduling, set repository variable `APP_URL` to the public HTTPS origin and Actions secret `CRON_SECRET` to the same value as the Vercel environment variable. The new `.github/workflows/customer-tab-cron.yml` runs every five minutes and supports manual dispatch. It is skipped until `APP_URL` is set. GitHub scheduled execution can be delayed, so use an authenticated external one-minute scheduler for tighter timing. Avoid adding another scheduler if the existing webhook scheduler already handles these jobs.

Automatic reminders respect the customer's Messenger window, opt-out, bot pause, global agent switch and AI quota. A customer outside the allowed messaging window is held for review; winning an auction does not invent permission to send later reminders. Fully paid balances cancel pending reminders. Production migrations, Meta permissions and scheduler execution must be verified on the deployed environment; local tests use mocked APIs and a disposable PostgreSQL engine.
