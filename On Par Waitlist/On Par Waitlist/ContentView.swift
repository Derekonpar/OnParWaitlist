//
//  ContentView.swift
//  On Par Waitlist
//

import SwiftUI
import WebKit

struct ContentView: View {
    @State private var isLoading = true
    @State private var errorMessage: String? = nil
    @State private var reloadToken = UUID()

    var body: some View {
        ZStack {
            WaitlistWebView(
                url: AppConfig.waitlistURL,
                reloadToken: reloadToken,
                isLoading: $isLoading,
                errorMessage: $errorMessage
            )
            .ignoresSafeArea(edges: .bottom)

            if isLoading {
                VStack(spacing: 10) {
                    ProgressView()
                        .progressViewStyle(.circular)
                    Text("Loading waitlist…")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(.white.opacity(0.9))
                    Text(AppConfig.waitlistURL.absoluteString)
                        .font(.caption.monospaced())
                        .foregroundStyle(.white.opacity(0.45))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
                .padding(18)
                .background(.black.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding()
            }

            if let errorMessage {
                VStack(spacing: 12) {
                    Text("Can’t reach the server")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                    Text(AppConfig.waitlistURL.absoluteString)
                        .font(.caption.monospaced())
                        .foregroundStyle(.white.opacity(0.5))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 18)

                    HStack(spacing: 10) {
                        Button("Open in Safari") {
                            UIApplication.shared.open(AppConfig.waitlistURL)
                        }
                        .buttonStyle(.borderedProminent)

                        Button("Retry") {
                            isLoading = true
                            self.errorMessage = nil
                            reloadToken = UUID()
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(18)
                .background(.black.opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding()
            }
        }
    }
}

struct WaitlistWebView: UIViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 10 / 255, green: 10 / 255, blue: 10 / 255, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Reload when the token changes (Retry button)
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            uiView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: WaitlistWebView
        weak var webView: WKWebView?
        var lastReloadToken: UUID?

        init(_ parent: WaitlistWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = true
                self.parent.errorMessage = nil
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.errorMessage = nil
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let requestURL = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            // Keep in-app navigation on the same host (waitlist + status pages)
            if navigationAction.navigationType == .linkActivated,
               let host = webView.url?.host,
               requestURL.host != host {
                UIApplication.shared.open(requestURL)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.errorMessage = error.localizedDescription
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    ContentView()
}
