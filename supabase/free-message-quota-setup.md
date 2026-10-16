# Free: 100 shared messages per calendar month

Run `free-message-quota.sql` LAST, after `feature-access.sql` and the existing package/payment migrations, then deploy the application. No customer records or purchased top-up credits are deleted.

Free receives 100 messages each calendar month in Asia/Bangkok. Broadcasts, automated chat replies, slip notifications, comment replies and private comment replies share the same credit buckets. Each accepted physical outgoing message costs one credit; failed sends refund their reservation. Broadcast batch reservations are not charged again by the common delivery helper.

Existing Free balances are reduced using the old allowance and remaining credits, preserving usage already spent this month. A shop that already used 100 or more free messages receives no additional free credits. Purchased `broadcast_topup_credits` and `slip_quota_credits` remain unchanged. Top-ups are used after monthly message credits and accumulate without resetting the other bucket.

AI Agent keeps its confirmed Pro entitlement. Image assistant and Customer Follow-up require an active supported Starter/Pro subscription. A Broadcast top-up does not unlock these advanced features. The new `customer_follow_up` entitlement, restrictive job RLS and settings trigger protect direct calls and background workers without an admin-owned Free bypass.

Free shops can buy message top-ups and send basic broadcasts without unlocking CRM. Broadcast audience APIs return counts only; customer details remain protected by the existing customer feature gate. Provider messaging-window restrictions still apply.

Never apply older permissive quota/security migrations after this migration without reapplying it last. Tests: `test-free-message-quota-sql.cjs` (isolated PostgreSQL) and `test-message-quota.cjs` (mocked Meta delivery).
