# TestFlight — On Par Waitlist (iOS)

The iOS app is a **WebView shell** that loads your live site:

**https://onparwaitlist.com**

No backend code ships in the app — Vercel + Supabase must be working first (they are).

---

## Before you archive (checklist)

### Backend (Vercel) — already live

| Check | Status |
|-------|--------|
| Site loads | https://onparwaitlist.com |
| Join waitlist works | Test on your phone in Safari |
| Supabase saving guests | Table Editor → `customers` + `waitlist_entries` |
| Staff console | https://onparwaitlist.com/staff |

### Vercel env vars (Production)

These must be set in Vercel → Settings → Environment Variables:

- `NEXT_PUBLIC_APP_URL` = `https://onparwaitlist.com`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STAFF_SECRET`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (for SMS)
- `VENUE_NAME`, `VENUE_PHONE`, `CONTACT_EMAIL`

### iOS project

Open: **`On Par Waitlist/On Par Waitlist.xcodeproj`**

`Config.swift` already points physical devices to production:

```swift
static let productionWaitlistURL = "https://onparwaitlist.com"
```

Simulator still uses `http://127.0.0.1:3000` for local dev.

---

## Push to TestFlight (step by step)

You need an **Apple Developer Program** membership ($99/year). TestFlight does not work with a free Personal Team alone.

### 1. Open the project in Xcode

```text
On Par Waitlist/On Par Waitlist.xcodeproj
```

### 2. Signing

1. Select the **On Par Waitlist** target
2. **Signing & Capabilities**
3. **Team** → your paid developer team (`Q3732K9A5F`)
4. **Automatically manage signing** → ON
5. Confirm **Bundle Identifier** matches App Store Connect  
   Current: `ios-OnParWaitlist-Config.swift.On-Par-Waitlist`

### 3. Bump the build number

Each TestFlight upload needs a **new build number** (even if version stays `1.0`):

1. Target → **General**
2. **Build** → increment (e.g. `2` → `3` for your next upload)
3. Or edit **CURRENT_PROJECT_VERSION** in the project

### 4. Select a real device destination

In the Xcode toolbar, choose **Any iOS Device (arm64)** — not a simulator.

### 5. Archive

1. Menu → **Product → Archive**
2. Wait for the archive to finish
3. **Organizer** opens automatically (Window → Organizer if not)

### 6. Upload to App Store Connect

1. In Organizer, select the new archive
2. Click **Distribute App**
3. **App Store Connect** → **Upload**
4. Defaults are fine (include bitcode off, strip symbols on, etc.)
5. Wait for upload to complete

### 7. App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. **My Apps** → **On Par Waitlist** (or your app name)
3. **TestFlight** tab
4. Wait for build processing (usually 5–30 minutes)
5. If prompted, fill in **Export Compliance** (typically “No” for this WebView app)
6. Add **Internal** or **External** testers
7. For external testers, submit the build for **Beta App Review** (first time per version)

### 8. Install on your phone

1. Install **TestFlight** from the App Store
2. Open the invite link or find the app in TestFlight
3. Install the build
4. Open the app — it should load the live waitlist

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Failed to register bundle identifier” | Bundle ID in Xcode must match App Store Connect exactly |
| Upload rejected — missing compliance | App Store Connect → TestFlight → answer encryption question |
| Black screen / can’t reach server | Confirm `Config.swift` production URL; test same URL in Safari on the phone |
| Join works in Safari but not in app | Hard-close app and reopen; tap **Retry** on error overlay |
| Build doesn’t appear in TestFlight | Wait longer; check email from Apple for processing errors |

---

## Quick test without TestFlight

For day-to-day staff testing, the **QR code** at `/qr` or Safari at the production URL is enough — no App Store required.
