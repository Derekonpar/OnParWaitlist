# Deploy to Vercel (standard Next.js)

This is a normal **Next.js App Router** project in the `web/` folder.

## Vercel settings (only thing that matters)

| Setting | Value |
|---------|--------|
| **Root Directory** | `web` |
| **Framework Preset** | Next.js (auto) |
| **Build Command** | *(leave default — `next build`)* |
| **Install Command** | *(leave default — `npm install`)* |
| **Output Directory** | *(leave default — do not set manually)* |

Do **not** set a custom Output Directory. Do **not** use npm workspaces from the repo root.

## Steps

1. [vercel.com/new](https://vercel.com/new) → Import **Derekonpar/OnParWaitlist**
2. Set **Root Directory** → **`web`**
3. Deploy
4. Add **Upstash Redis** (Storage → Marketplace) so the waitlist persists for all guests
5. Environment variables (Settings → Environment Variables):

| Variable | Required |
|----------|----------|
| `NEXT_PUBLIC_APP_URL` | Yes — your `https://….vercel.app` URL |
| `STAFF_SECRET` | Yes |
| `UPSTASH_REDIS_REST_URL` | Yes (from Upstash integration) |
| `UPSTASH_REDIS_REST_TOKEN` | Yes |
| Twilio vars | Optional (for SMS) |

6. **Redeploy** after adding env vars

## iOS app

After deploy, set `productionWaitlistURL` in `On Par Waitlist/On Par Waitlist/Config.swift` to your Vercel URL.

## Local dev

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000
