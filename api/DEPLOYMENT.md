# API deployment notes

## Required database migration

Before deploying the Worker, apply
`supabase/migrations/202611250001_atomic_credits_and_rate_limits.sql`
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

## Important payment database prerequisite

The repository calls the Supabase RPC `process_paid_payment(p_invoice_id)` to mark an invoice paid and grant credits. Its SQL definition and the table DDL are not present in this repository. Before enabling live payments, inspect that function and verify that it:

1. Locks or conditionally updates the payment row so concurrent webhook/reconcile calls cannot grant twice.
2. Grants the package credits and marks the payment PAID in the same database transaction.
3. Rejects unknown invoices, invalid package IDs, and already-processed payments safely.
4. Uses a unique constraint on `payment.invoice_id`.

Do not enable production payments until this function has been reviewed and tested against the actual schema.

## Telegram client requirement

The frontend now sends the raw `Telegram.WebApp.initData` in the
`X-Telegram-Init-Data` header. Requests made outside a real Telegram Web App
session are rejected. The user ID is taken from the validated signed payload on
the server, not from query parameters or localStorage.
