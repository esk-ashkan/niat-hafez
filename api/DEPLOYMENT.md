# API deployment notes

## Required database migration

Before deploying the Worker, apply
`api/supabase/migrations/202611250001_atomic_credits_and_rate_limits.sql`
to the Supabase project used by this app.

It creates:

- `consume_hafez_credit(tgid)`: one atomic database update. Purchased credits are consumed first; otherwise one free credit is consumed.
- `consume_api_rate_limit(key, limit, window_seconds)`: atomic per-user rate-limit counter.

The Worker calls these RPC functions. Deploying the Worker without applying the migration will make fortune requests and rate-limited endpoints fail.

## Worker configuration

Configure these Cloudflare Worker variables/secrets:

| Name | Type | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Secret/variable | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Secret | Keep server-side only |
| `TELEGRAM_BOT_TOKEN` | Secret | Used to validate Telegram Web App init data |
| `BLUPAL_API_KEY` | Secret | BluPal API key |
| `BLUPAL_MODE` | Variable | Must be exactly `live` for live invoices or `sandbox` for sandbox invoices |
| `WEB_APP_URL` | Variable | Telegram Mini App URL |
| `GROQ_API_KEY` | Secret, optional | Primary interpretation provider |
| `APINEX_API_KEY` | Secret, optional | Fallback interpretation provider |

Set `BLUPAL_MODE` to match the actual BluPal account/API environment. The API intentionally rejects invoices when the variable is missing or the provider's returned mode does not match.

## Payment database function review

The existing `public.process_paid_payment(p_invoice_id bigint)` function has been reviewed. It uses `SELECT ... FOR UPDATE` on the payment row, checks for an already-PAID invoice, adds credits, and marks the invoice PAID in the same transaction. This is a sound idempotent pattern for concurrent webhook and reconciliation calls **provided that `payment.invoice_id` is unique**.

Before enabling live payments, verify the database constraints and data:

```sql
-- These queries should return no duplicate groups.
select invoice_id, count(*)
from public.payment
group by invoice_id
having count(*) > 1;

select tgid, count(*)
from public.profile
group by tgid
having count(*) > 1;

-- Inspect existing primary keys and unique constraints.
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
where tc.table_schema = 'public'
  and tc.table_name in ('payment', 'profile')
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
order by tc.table_name, tc.constraint_name;
```

Ensure `payment.invoice_id` and `profile.tgid` each have a UNIQUE or PRIMARY KEY constraint. Do not add constraints until duplicate rows, if any, have been resolved. The profile constraint matters because the payment function must update exactly one account.

The current Supabase privilege inspection showed `EXECUTE` granted to `PUBLIC`, `anon`, `authenticated`, `postgres`, and `service_role`. Restrict it with this SQL in the Supabase SQL Editor:

```sql
REVOKE ALL ON FUNCTION public.process_paid_payment(bigint)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_paid_payment(bigint)
TO service_role;
```

Keep the `postgres` owner/admin access. Verify the result by rerunning the `information_schema.routine_privileges` query: `service_role` and the database owner/admin may retain access, but `PUBLIC`, `anon`, and `authenticated` should no longer appear.

This is a database privilege change, not an application-code change. Apply it directly to the Supabase project; keep the SQL documented here so the production setup is reproducible.

The function's package-to-credit mapping must remain aligned with the Worker `PACKAGES` configuration. Consider moving this mapping into a database package table in a later cleanup to avoid maintaining it twice.

The function is called by the Worker only after the provider invoice has been fetched and checked for invoice ID, PAID status, amount, and configured mode. Keep the function inaccessible to `anon` and `authenticated`; only the server-side `service_role` should be able to execute it.

Do not enable production payments until the constraints are verified and a sandbox payment has been tested end-to-end.

## Telegram client requirement

The frontend now sends the raw `Telegram.WebApp.initData` in the
`X-Telegram-Init-Data` header. Requests made outside a real Telegram Web App
session are rejected. The user ID is taken from the validated signed payload on
the server, not from query parameters or localStorage.
