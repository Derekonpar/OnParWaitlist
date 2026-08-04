#!/usr/bin/env swift
import ApplicationServices
import Foundation

func requireAccessibility(prompt: Bool) -> Bool {
  if prompt {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
  }
  return AXIsProcessTrusted()
}

func postKey(_ keyCode: CGKeyCode, down: Bool, flags: CGEventFlags = []) {
  guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: down) else { return }
  event.flags = flags
  event.post(tap: .cghidEventTap)
}

func replaceText(_ value: String, submit: Bool) {
  let keyCodes: [Character: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6,
    "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14,
    "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
    "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "o": 31,
    "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45,
    "m": 46, " ": 49,
  ]

  // Remote Desktop does not reliably forward Unicode-injection events or
  // Command+A. Clear the field with physical backspaces and type physical keys.
  for _ in 0..<32 {
    postKey(51, down: true)
    postKey(51, down: false)
  }
  for character in value.lowercased() {
    guard let keyCode = keyCodes[character] else { continue }
    postKey(keyCode, down: true)
    postKey(keyCode, down: false)
    usleep(35_000)
  }

  if submit {
    postKey(36, down: true)
    postKey(36, down: false)
  }
}

let args = Array(CommandLine.arguments.dropFirst())
let prompt = args.first == "prompt"
guard requireAccessibility(prompt: prompt) else {
  fputs("Brunswick Input does not have Accessibility permission\n", stderr)
  exit(77)
}

guard let command = args.first else { exit(0) }

switch command {
case "prompt":
  print("Accessibility enabled")
case "click":
  guard args.count == 3, let x = Double(args[1]), let y = Double(args[2]) else {
    fputs("Usage: Brunswick Input click X Y\n", stderr)
    exit(2)
  }
  let point = CGPoint(x: x, y: y)
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(60_000)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
case "replace":
  let value = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
  replaceText(value.trimmingCharacters(in: .newlines), submit: args.contains("--submit"))
default:
  fputs("Unknown command\n", stderr)
  exit(2)
}
