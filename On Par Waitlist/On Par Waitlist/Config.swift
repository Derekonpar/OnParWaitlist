//
//  Config.swift
//  On Par Waitlist
//

import Foundation

enum AppConfig {
    static let productionWaitlistURL = "https://on-par-waitlist.vercel.app"

    static let waitlistURL: URL = {
        #if targetEnvironment(simulator)
        return URL(string: "http://127.0.0.1:3000")!
        #else
        return URL(string: productionWaitlistURL)!
        #endif
    }()
}
