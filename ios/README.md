# On Par Waitlist — iOS (Xcode, no paid developer account)

This folder is a thin **SwiftUI + WebKit** shell that loads your deployed waitlist website. You do **not** need a paid Apple Developer Program membership to run it on **your own iPhone** for testing.

## Setup in Xcode

1. Open **Xcode** → **File → Open** → select `ios/OnParWaitlist.xcodeproj` (create project below if missing).
2. Edit `OnParWaitlist/Config.swift` and set `waitlistURL` to your live URL (same as `NEXT_PUBLIC_APP_URL`).
3. Select your iPhone as the run destination.
4. **Signing & Capabilities** → Team: your **Personal Team** (free Apple ID).
5. Press **Run** (⌘R). On first install, trust the developer on the device: **Settings → General → VPN & Device Management**.

Free provisioning refreshes about every **7 days**; rebuild from Xcode to renew.

## Create the Xcode project (first time)

If you do not see `.xcodeproj` yet:

1. Xcode → **File → New → Project** → **iOS → App**
2. Product Name: `OnParWaitlist`, Interface: **SwiftUI**, Language: **Swift**
3. Save inside this `ios/` folder.
4. Replace generated `ContentView.swift` and `OnParWaitlistApp.swift` with the files in `OnParWaitlist/`.
5. Add `Config.swift` to the target.
6. Replace **Info.plist** entries for local dev if needed.

## Alternative: no Xcode

Guests can use the **QR code** at `/qr` on any phone browser — no install required.
