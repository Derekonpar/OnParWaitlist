import Foundation

/// Set this to your Vercel production URL after deploy (same as Xcode project Config.swift).
enum AppConfig {
    static let productionWaitlistURL = "https://REPLACE-WITH-YOUR-VERCEL-URL.vercel.app"
    static let waitlistURL = URL(string: productionWaitlistURL)!
}
