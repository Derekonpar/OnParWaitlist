#!/usr/bin/env swift
import AppKit
import Foundation
import Vision

struct TextObservation: Encodable {
  let text: String
  let confidence: Float
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

guard CommandLine.arguments.count >= 2 else {
  fputs("Usage: brunswick-ocr.swift /path/to/screenshot.png\n", stderr)
  exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard
  let image = NSImage(contentsOf: imageURL),
  let tiff = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiff),
  let cgImage = bitmap.cgImage
else {
  fputs("Could not read screenshot image\n", stderr)
  exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.004

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
  try handler.perform([request])
} catch {
  fputs("OCR failed: \(error)\n", stderr)
  exit(1)
}

let observations = (request.results ?? []).compactMap { observation -> TextObservation? in
  guard let candidate = observation.topCandidates(1).first else {
    return nil
  }
  let box = observation.boundingBox
  return TextObservation(
    text: candidate.string,
    confidence: candidate.confidence,
    x: Double(box.midX),
    y: Double(box.midY),
    width: Double(box.width),
    height: Double(box.height)
  )
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(observations)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
