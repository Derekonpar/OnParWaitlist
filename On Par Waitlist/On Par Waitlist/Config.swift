//
//  Config.swift
//  On Par Waitlist
//

import Foundation

enum AppConfig {
    /// Set this to your Vercel production URL after first deploy (no trailing slash).
    /// Example: https://on-par-waitlist.vercel.app
    static let productionWaitlistURL = "https://REPLACE-WITH-YOUR-VERCEL-URL.vercel.app"

    static let waitlistURL: URL = {
        #if targetEnvironment(simulator)
        // Simulator can hit your Mac while developing the web app
        return URL(string: "http://127.0.0.1:3001")!
        #else
        // Physical iPhone: always use the stable hosted URL
        return URL(string: productionWaitlistURL)!
        #endif
    }()
}
