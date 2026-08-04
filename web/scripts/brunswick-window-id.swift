#!/usr/bin/env swift
import CoreGraphics
import Foundation

struct WindowCapture: Encodable {
  let id: Int
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
  as? [[String: Any]] ?? []

for window in windows {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  let title = window[kCGWindowName as String] as? String ?? ""
  guard owner == "Google Chrome" else { continue }
  guard title.localizedCaseInsensitiveContains("Brunswick") ||
    title.localizedCaseInsensitiveContains("Remote Desktop") else { continue }
  if let number = window[kCGWindowNumber as String] as? Int,
     let bounds = window[kCGWindowBounds as String] as? [String: Any],
     let x = bounds["X"] as? Double,
     let y = bounds["Y"] as? Double,
     let width = bounds["Width"] as? Double,
     let height = bounds["Height"] as? Double {
    let data = try JSONEncoder().encode(
      WindowCapture(id: number, x: x, y: y, width: width, height: height)
    )
    print(String(decoding: data, as: UTF8.self))
    exit(0)
  }
}

fputs("Could not find the visible Brunswick Chrome window\n", stderr)
exit(1)
