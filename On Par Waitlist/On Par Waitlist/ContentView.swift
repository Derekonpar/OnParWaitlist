//
//  ContentView.swift
//  On Par Waitlist
//

import SwiftUI
import WebKit

struct ContentView: View {
    @State private var webURL = AppConfig.waitlistURL
    @State private var isLoading = true
    @State private var errorMessage: String? = nil
    @State private var reloadToken = UUID()

    private var onStaffPage: Bool {
        AppConfig.isStaffPage(webURL)
    }

    var body: some View {
        VStack(spacing: 0) {
            appBar

            ZStack {
                WaitlistWebView(
                    url: webURL,
                    reloadToken: reloadToken,
                    isLoading: $isLoading,
                    errorMessage: $errorMessage
                )

                if isLoading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
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

                        HStack(spacing: 10) {
                            Button("Open in Safari") {
                                UIApplication.shared.open(webURL)
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
        .background(Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255))
        .ignoresSafeArea(edges: .bottom)
    }

    private var appBar: some View {
        HStack {
            if onStaffPage {
                Button {
                    goToWaitlist()
                } label: {
                    Label("Waitlist", systemImage: "list.bullet")
                        .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.9))
            }

            Spacer()

            if !onStaffPage {
                Button {
                    goToStaff()
                } label: {
                    Text("Staff")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.white.opacity(0.12))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255))
    }

    private func goToStaff() {
        webURL = AppConfig.staffURL
        isLoading = true
        errorMessage = nil
        reloadToken = UUID()
    }

    private func goToWaitlist() {
        webURL = AppConfig.waitlistURL
        isLoading = true
        errorMessage = nil
        reloadToken = UUID()
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
        context.coordinator.lastURL = url
        context.coordinator.lastReloadToken = reloadToken
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        if context.coordinator.lastURL != url || context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastURL = url
            context.coordinator.lastReloadToken = reloadToken
            uiView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: WaitlistWebView
        weak var webView: WKWebView?
        var lastReloadToken: UUID?
        var lastURL: URL?

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
