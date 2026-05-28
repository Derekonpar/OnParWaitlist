# Deploy On Par Waitlist to Vercel

## 1. Connect GitHub to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import **`Derekonpar/OnParWaitlist`**
3. Configure the project — **pick ONE of these options** (both work):

### Option A (recommended): Root Directory = `web`

| Setting | Value |
|---------|--------|
| **Framework Preset** | Next.js |
| **Root Directory** | `web` |
| **Build Command** | `npm run build` (default) |
| **Install Command** | `npm install` (default) |

### Option B: Root Directory = `.` (repo root)

Use this if you already imported without `web` as root. The repo includes a root `package.json` + `vercel.json` for workspaces.

| Setting | Value |
|---------|--------|
| **Framework Preset** | Next.js |
| **Root Directory** | `.` (leave empty / repository root) |
| **Build Command** | `npm run build -w web` |
| **Install Command** | `npm install` |

4. Deploy once.

### Fix: `404: NOT_FOUND` on Vercel

This almost always means Vercel is **not building the Next.js app in `web/`**.

1. Vercel → your project → **Settings** → **General** → **Root Directory**
2. Set to **`web`** (Option A) **OR** use Option B commands above
3. **Save** → **Deployments** → **Redeploy** (use “Redeploy with existing Build Cache” **unchecked**)

After a good deploy, visiting `/` should show the dark On Par waitlist UI — not a plain “404 NOT_FOUND” page.

## 2. Add Upstash Redis (required for production)

Everyone must see the **same** waitlist:

1. Vercel project → **Storage** → **Marketplace** → **Upstash Redis**
2. Create / connect a database
3. Vercel auto-adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
4. **Redeploy**

## 3. Environment variables

In Vercel → **Settings** → **Environment Variables**:

| Variable | Required | Example |
|----------|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Yes | `https://your-project.vercel.app` |
| `STAFF_SECRET` | Yes | long random password |
| `UPSTASH_REDIS_REST_URL` | Yes (via integration) | auto |
| `UPSTASH_REDIS_REST_TOKEN` | Yes (via integration) | auto |
| `TWILIO_ACCOUNT_SID` | For SMS | from Twilio |
| `TWILIO_AUTH_TOKEN` | For SMS | from Twilio |
| `TWILIO_PHONE_NUMBER` | For SMS | `+1...` |
| `VENUE_NAME` | Optional | `On Par Entertainment` |

Copy names from `web/.env.example`.

After changing env vars, **Redeploy**.

## 4. Stable URL for QR + iOS app

Your permanent guest link:

- Home: `https://YOUR-PROJECT.vercel.app`
- QR page: `https://YOUR-PROJECT.vercel.app/qr`

Update Xcode `On Par Waitlist/On Par Waitlist/Config.swift`:

```swift
static let productionWaitlistURL = "https://YOUR-PROJECT.vercel.app"
```

Rebuild the iOS app. No more Mac IP addresses.

## 5. Custom domain (optional)

Vercel → **Domains** → add e.g. `waitlist.onparentertainment.com`, then update `NEXT_PUBLIC_APP_URL` and `Config.swift` to match.
