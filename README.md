# On Par Entertainment — Waitlist

Live waitlist for **bowling**, **darts**, **pool**, and **shuffleboard**, with optional **Twilio SMS** when guests opt in.

| Piece | Purpose |
|--------|---------|
| **`web/`** | Next.js app (deploy this to Vercel) |
| **`/qr`** | Printable QR → permanent public link |
| **`/staff`** | Notify / serve / remove parties |
| **`On Par Waitlist/`** | Xcode iOS shell (loads your Vercel URL) |
| **`ios/`** | Reference Swift sources |

## Deploy to Vercel (stable, always-on URL)

This repo is set up for Vercel with **Root Directory = `web`**.

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for step-by-step: GitHub import, Upstash Redis, env vars, and iOS `Config.swift`.

## Local development

```bash
cd web
cp .env.example .env.local
# Set STAFF_SECRET at minimum
npm install
npm run dev
```

- App: http://localhost:3001  
- QR: http://localhost:3001/qr  
- Staff: http://localhost:3001/staff  

## Repository layout

```
OnParWaitlist/
├── web/                 ← Vercel Root Directory
│   ├── vercel.json
│   └── src/
├── On Par Waitlist/     ← Xcode project
├── ios/                 ← Swift reference files
└── DEPLOYMENT.md
```
