# Twilio setup

Your site: **https://on-par-waitlist.vercel.app**

## Step 1: Get credentials from Twilio

1. Log in at [console.twilio.com](https://console.twilio.com)
2. On the dashboard, copy:
   - **Account SID** (starts with `AC…`)
   - **Auth Token** (click to reveal)
3. Go to **Phone Numbers → Manage → Active numbers**
4. Copy your Twilio number in **E.164** format, e.g. `+19375551234`

## Step 2: Add env vars in Vercel

Vercel → your project → **Settings → Environment Variables**

Add these for **Production** (and Preview if you want):

| Variable | Example | Notes |
|----------|---------|--------|
| `TWILIO_ACCOUNT_SID` | `ACxxxxxxxx` | From Twilio dashboard |
| `TWILIO_AUTH_TOKEN` | `your_auth_token` | Keep secret |
| `TWILIO_PHONE_NUMBER` | `+19375551234` | Must include `+1` |
| `VENUE_NAME` | `On Par Entertainment` | Used in message text |
| `NEXT_PUBLIC_APP_URL` | `https://on-par-waitlist.vercel.app` | Already set? verify |
| `STAFF_SECRET` | your password | For staff console |

Click **Save**, then **Deployments → Redeploy** (uncheck build cache).

## Step 3: Configure inbound SMS (STOP / HELP)

Twilio → **Phone Numbers** → your number → **Configure**

Under **Messaging Configuration**:

| Field | Value |
|-------|--------|
| **A message comes in** | Webhook |
| **URL** | `https://on-par-waitlist.vercel.app/api/twilio/inbound` |
| **HTTP** | `POST` |

Save. This handles **STOP**, **START**, and **HELP** replies.

## Step 4: Test SMS

### Option A — Full guest flow

1. Open https://on-par-waitlist.vercel.app
2. Tap **Get on waitlist** on any activity
3. Enter your name + **your real phone number**
4. Check **Text me when I'm up**
5. Join — you should get a confirmation text with your position

### Option B — Staff “Notify” (you’re up message)

1. Join the waitlist with SMS opt-in (Option B)
2. Go to https://on-par-waitlist.vercel.app/staff
3. Enter your `STAFF_SECRET`
4. Tap **Notify** next to your name
5. You should get the “You’re up!” text

## Step 5: Test opt-out

Reply **STOP** to the text. You should get an unsubscribe confirmation.

Try joining again with SMS checked — it should block texts until you reply **START**.

Or use https://on-par-waitlist.vercel.app/sms to unsubscribe online.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No text received | Confirm all 3 Twilio env vars in Vercel + redeployed |
| `SMS not sent` in API response | Env vars missing on Vercel (not just local) |
| Twilio error 21608 / unverified | Trial accounts can only text **verified** numbers — add your phone in Twilio → Verified Caller IDs |
| Wrong number format | Use 10 digits or `+1` prefix in requests |
| Number opted out | Reply **START** to your Twilio number, or remove from opt-out via Redis/data |

## Twilio campaign URLs (for your records)

- Opt-in page: `https://on-par-waitlist.vercel.app/sms`
- Inbound webhook: `https://on-par-waitlist.vercel.app/api/twilio/inbound`
