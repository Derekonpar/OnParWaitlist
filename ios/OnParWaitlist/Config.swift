import Foundation

enum AppConfig {
    static let productionWaitlistURL = "https://on-par-waitlist.vercel.app"
    static let waitlistURL = URL(string: productionWaitlistURL)!
}
