# Deploy On Par Waitlist

## Architecture

| Piece | Where |
|-------|--------|
| Guest + staff web app | `web/` on **Vercel** |
| Customer + waitlist database | **Supabase** |
| SMS | **Twilio** |
| iOS shell app | `On Par Waitlist/` → **TestFlight** |

**Production URL:** https://onparwaitlist.com

---

## Vercel setup

| Setting | Value |
|---------|--------|
| **Root Directory** | `web` |
| **Framework** | Next.js (auto) |

Import repo: [github.com/Derekonpar/OnParWaitlist](https://github.com/Derekonpar/OnParWaitlist)

### Environment variables (Production + Preview)

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_APP_URL` | Yes | `https://onparwaitlist.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (secret) |
| `STAFF_SECRET` | Yes | Password for `/staff` |
| `TWILIO_ACCOUNT_SID` | For SMS | |
| `TWILIO_AUTH_TOKEN` | For SMS | |
| `TWILIO_PHONE_NUMBER` | For SMS | |
| `VENUE_NAME` | Yes | `On Par Entertainment` |
| `VENUE_PHONE` | Yes | `937-705-6024` |
| `CONTACT_EMAIL` | Yes | `info@onparbar.com` |

Redeploy after changing env vars.

### Supabase tables

Run once in Supabase → SQL Editor:

1. `supabase/schema.sql` (full setup)
2. If you used GitHub integration and hit errors, also run `supabase/fix-500.sql`

See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

### Twilio

- Campaign / opt-in page: `https://onparwaitlist.com/sms`
- Inbound webhook: `https://onparwaitlist.com/api/twilio/inbound` (POST)

See [TWILIO_SETUP.md](./TWILIO_SETUP.md).

### Verify production

```bash
cd web
node scripts/test-live.mjs https://onparwaitlist.com
```

Or open `https://onparwaitlist.com/api/waitlist/health` — should show `"canWrite": true`.

---

## iOS app

- Xcode project: `On Par Waitlist/On Par Waitlist.xcodeproj`
- Production URL in `Config.swift`: `https://onparwaitlist.com`
- **TestFlight steps:** [TESTFLIGHT.md](./TESTFLIGHT.md)

---

## Local dev

```bash
cd web
cp .env.example .env.local   # fill in Supabase + Twilio
npm install
npm run dev
```

Open http://localhost:3000 (simulator uses this URL automatically).
