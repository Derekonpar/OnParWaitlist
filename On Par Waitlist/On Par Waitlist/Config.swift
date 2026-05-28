//
//  Config.swift
//  On Par Waitlist
//

import Foundation

enum AppConfig {
    /// Production waitlist (Vercel). Must match NEXT_PUBLIC_APP_URL in Vercel env.
    static let productionWaitlistURL = "https://on-par-waitlist.vercel.app"

    static let waitlistURL: URL = {
        #if targetEnvironment(simulator)
        return URL(string: "http://127.0.0.1:3000")!
        #else
        return URL(string: productionWaitlistURL)!
        #endif
    }()
}
