import AppKit
import AVFoundation

// Sample the launch recording for visual inspection; this does not infer touch behavior.
let input = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
let asset = AVURLAsset(url: URL(fileURLWithPath: input))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
let seconds = min(60, CMTimeGetSeconds(asset.duration))
for index in 0..<Int(seconds * 10) {
    let time = CMTime(seconds: Double(index) / 10, preferredTimescale: 600)
    if let image = try? generator.copyCGImage(at: time, actualTime: nil) {
        let bitmap = NSBitmapImageRep(cgImage: image)
        if let data = bitmap.representation(using: .png, properties: [:]) {
            try data.write(to: URL(fileURLWithPath: output).appendingPathComponent(String(format: "%03d.png", index)))
        }
    }
}
