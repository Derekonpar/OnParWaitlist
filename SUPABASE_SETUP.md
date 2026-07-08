# Supabase setup (customer + waitlist database)

Your waitlist saves **every guest** to Supabase — name, phone, visit count, SMS opt-in, and rewards opt-in — so you can analyze customers and run a rewards program later.

## 1. Create tables (one time)

In [Supabase](https://supabase.com) → your project → **SQL Editor**, paste and run the full contents of `supabase/schema.sql`.

**Safe to re-run** — if tables already existed from the GitHub integration, this adds missing columns and converts enum types (like `WaitlistStatus`) to plain text the app expects.

If join/board still fail after that, also run `supabase/fix-500.sql` — it handles duplicate camelCase/snake_case columns and legacy required fields like `publicToken`, `displayName`, and `updatedAt`.

If you still get type errors and have no real data yet, run the reset block at the top of `schema.sql` first, then run the full script again.

That creates:

- **customers** — phone (unique), name, visit count, rewards opt-in, SMS opt-out flag
- **waitlist_entries** — each line in the queue, linked to a customer

## 2. Environment variables

In **Vercel** → Project → Settings → Environment Variables, add:

| Variable | Where to find it |
|----------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key (keep secret) |

Redeploy after saving env vars.

For local dev, copy `web/.env.example` to `web/.env.local` and fill in the same values.

## 3. Confirm it works

1. Join the waitlist from your phone or `https://onparwaitlist.com`
2. In Supabase → **Table Editor** → `customers` — you should see the new row
3. `waitlist_entries` should have the matching queue entry

## Staff console

Staff use **`/staff`** directly (no link on the guest app). Password is `STAFF_SECRET` in Vercel env vars.

From staff you can:

- Tap any guest → **Notify** (sends “you’re up” SMS if they opted in)
- **Add guest** manually
- Mark **Served** or **Remove**

## Analyzing customers

In Supabase you can:

- Export `customers` as CSV
- Run SQL, e.g. `select * from customers where rewards_opt_in = true`
- Connect a BI tool or spreadsheet to Supabase later
