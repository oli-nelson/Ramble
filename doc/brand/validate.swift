// Offline asset checks using the macOS system decoders.
import Foundation
import CoreGraphics
import ImageIO
let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "doc/brand")
let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)!
var checked = 0
for case let url as URL in files where ["png", "ico", "icns"].contains(url.pathExtension) {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { fatalError("Cannot open \(url.path)") }
    let count = CGImageSourceGetCount(source)
    precondition(count > 0)
    for i in 0..<count {
        guard let image = CGImageSourceCreateImageAtIndex(source, i, nil) else { fatalError("Cannot decode \(url.path) frame \(i)") }
        precondition(image.width > 0 && image.height > 0)
        if url.pathExtension == "png" && !url.lastPathComponent.contains("preview") {
            let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            let bytes = context.data!.assumingMemoryBound(to: UInt8.self)
            precondition(bytes[3] == 0, "Expected transparent canvas corner: \(url.path)")
            precondition((0..<(image.width * image.height)).contains { bytes[$0 * 4 + 3] > 0 }, "Empty image: \(url.path)")
        }
    }
    if url.pathExtension != "png" { print("Decoded \(url.lastPathComponent): \(count) representations") }
    checked += 1
}
print("Validated \(checked) image files, including transparent nonempty PNGs")
// Inspect actual low-resolution images, enlarged without smoothing.
let w = 1000, h = 300
let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
c.setFillColor(CGColor(gray: 0.8, alpha: 1)); c.fill(CGRect(x: 0, y: 0, width: w, height: h)); c.interpolationQuality = .none
for (i, size) in [16, 24, 32, 48, 64].enumerated() {
    let src = CGImageSourceCreateWithURL(root.appendingPathComponent("app/ramble-\(size).png") as CFURL, nil)!
    c.draw(CGImageSourceCreateImageAtIndex(src, 0, nil)!, in: CGRect(x: 15 + i * 198, y: 60, width: 170, height: 170))
}
let dest = CGImageDestinationCreateWithURL(root.appendingPathComponent("ramble-small-size-review.png") as CFURL, "public.png" as CFString, 1, nil)!
CGImageDestinationAddImage(dest, c.makeImage()!, nil); precondition(CGImageDestinationFinalize(dest))
