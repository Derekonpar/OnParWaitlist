# Cloudflare hosting (Workers)

Production Worker: **https://onpar-waitlist.derek-668.workers.dev**

## Finish cutover (required)

Vercel env secrets cannot be pulled locally (encrypted). Set them in Cloudflare:

1. Open [Workers → onpar-waitlist → Settings → Variables and Secrets](https://dash.cloudflare.com/6681e820824c54c67a6d694ffe03db20/workers/services/view/onpar-waitlist/production/settings)
2. Add these **secrets** (copy from Vercel → Project → Settings → Environment Variables):

- `NEXT_PUBLIC_APP_URL` = `https://onparwaitlist.com`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STAFF_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `VENUE_NAME`
- `DARTSEE_ADMIN_EMAIL`
- `DARTSEE_ADMIN_PASSWORD`
- `DARTSEE_BOARD_IDS`
- `DARTSEE_VENUE_ID`
- `NEXT_PUBLIC_VENUE_DART_LANES`

3. In Cloudflare DNS for `onparwaitlist.com`, **delete** the A records for `@` and `www` that point to `76.76.21.21` (Vercel).
4. Then either:

**Option A (recommended)** — Workers Custom Domains  
Workers → onpar-waitlist → Settings → Domains & Routes → Add `onparwaitlist.com` and `www.onparwaitlist.com`

**Option B** — tell the agent “DNS cleared” and we re-run domain attach via CLI.

5. Update Twilio inbound webhook if needed (already `https://onparwaitlist.com/api/twilio/inbound` once DNS points here).

## Deploy commands

```bash
cd web
npm run deploy
```

## Notes

- App uses Supabase for data (same as Vercel). Cloudflare hosting does **not** remove Supabase egress.
- Local file waitlist storage is disabled on Workers.
