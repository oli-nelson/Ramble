// Ramble option 4 production artwork. macOS-only exporter; no third-party dependencies.
import Foundation
import AppKit
import CoreText
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "doc/brand")
let fm = FileManager.default
for dir in ["svg", "png", "app/ramble.iconset"] { try fm.createDirectory(at: root.appendingPathComponent(dir), withIntermediateDirectories: true) }
func color(_ hex: String) -> CGColor {
    let n = UInt32(hex, radix: 16)!
    return CGColor(red: CGFloat((n >> 16) & 255)/255, green: CGFloat((n >> 8) & 255)/255, blue: CGFloat(n & 255)/255, alpha: 1)
}
let ink = "172128", ivory = "F5F1DF", mint = "87E7B8"
func bubble() -> CGPath {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: 160, y: 96)); p.addLine(to: CGPoint(x: 352, y: 96))
    p.addCurve(to: CGPoint(x: 432, y: 176), control1: CGPoint(x: 400, y: 96), control2: CGPoint(x: 432, y: 128))
    p.addLine(to: CGPoint(x: 432, y: 288))
    p.addCurve(to: CGPoint(x: 352, y: 368), control1: CGPoint(x: 432, y: 336), control2: CGPoint(x: 400, y: 368))
    p.addLine(to: CGPoint(x: 202, y: 368))
    p.addCurve(to: CGPoint(x: 116, y: 408), control1: CGPoint(x: 177, y: 368), control2: CGPoint(x: 140, y: 396))
    p.addQuadCurve(to: CGPoint(x: 108, y: 402), control: CGPoint(x: 106, y: 413))
    p.addLine(to: CGPoint(x: 118, y: 360))
    p.addCurve(to: CGPoint(x: 80, y: 288), control1: CGPoint(x: 94, y: 347), control2: CGPoint(x: 80, y: 322))
    p.addLine(to: CGPoint(x: 80, y: 176))
    p.addCurve(to: CGPoint(x: 160, y: 96), control1: CGPoint(x: 80, y: 128), control2: CGPoint(x: 112, y: 96))
    p.closeSubpath(); return p
}
let outer = bubble()
let top = CGMutablePath()
top.move(to: CGPoint(x: 154, y: 164)); top.addLine(to: CGPoint(x: 264, y: 164))
top.addCurve(to: CGPoint(x: 385, y: 230), control1: CGPoint(x: 311, y: 164), control2: CGPoint(x: 296, y: 230))
top.addCurve(to: CGPoint(x: 264, y: 194), control1: CGPoint(x: 310, y: 230), control2: CGPoint(x: 301, y: 194))
top.addLine(to: CGPoint(x: 154, y: 194)); top.addCurve(to: CGPoint(x: 154, y: 164), control1: CGPoint(x: 134, y: 194), control2: CGPoint(x: 134, y: 164)); top.closeSubpath()
var mirror = CGAffineTransform(translationX: 0, y: 464).scaledBy(x: 1, y: -1)
let bottom = top.copy(using: &mirror)!
let middle = CGPath(roundedRect: CGRect(x: 139, y: 218, width: 254, height: 28), cornerWidth: 14, cornerHeight: 14, transform: nil)
let cuts: [CGPath] = [top, middle, bottom]
func svgPath(_ path: CGPath) -> String {
    var s = ""
    func n(_ x: CGFloat) -> String { String(format: "%.3f", Double(x)).replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression) }
    path.applyWithBlock { ptr in
        let e = ptr.pointee, p = e.points
        switch e.type {
        case .moveToPoint: s += "M\(n(p[0].x)) \(n(p[0].y))"
        case .addLineToPoint: s += "L\(n(p[0].x)) \(n(p[0].y))"
        case .addQuadCurveToPoint: s += "Q\(n(p[0].x)) \(n(p[0].y)) \(n(p[1].x)) \(n(p[1].y))"
        case .addCurveToPoint: s += "C\(n(p[0].x)) \(n(p[0].y)) \(n(p[1].x)) \(n(p[1].y)) \(n(p[2].x)) \(n(p[2].y))"
        case .closeSubpath: s += "Z"
        @unknown default: break
        }
    }; return s
}
// Outlined system-font wordmark: exported files contain no fonts or live text.
func textPath(_ text: String, size: CGFloat, x: CGFloat, baseline: CGFloat, bold: Bool = false) -> CGPath {
    let font = NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular) as CTFont
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]))
    let result = CGMutablePath()
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: count), points = [CGPoint](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: 0), &points)
        for i in 0..<count {
            if let glyph = CTFontCreatePathForGlyph(font, glyphs[i], nil) {
                let t = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: x + points[i].x, ty: baseline - points[i].y)
                result.addPath(glyph, transform: t)
            }
        }
    }; return result
}
enum Variant: String, CaseIterable { case primary, dark, light, black, white }
func fillColor(_ v: Variant) -> String {
    switch v { case .primary, .dark: return ivory; case .light: return ink; case .black: return "000000"; case .white: return "FFFFFF" }
}
func accent(_ v: Variant) -> Bool { v == .primary || v == .dark || v == .light }
func gradient(_ c: CGContext, path: CGPath, colors: [String], from: CGPoint, to: CGPoint) {
    c.saveGState(); c.addPath(path); c.clip()
    let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors.map { color($0) } as CFArray, locations: nil)!
    c.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]); c.restoreGState()
}
func drawMark(_ c: CGContext, variant: Variant) {
    c.saveGState(); c.beginTransparencyLayer(auxiliaryInfo: nil)
    if variant == .primary { gradient(c, path: outer, colors: ["FFFDF0", "D9D8CB"], from: CGPoint(x: 120, y: 96), to: CGPoint(x: 400, y: 400)) }
    else { c.setFillColor(color(fillColor(variant))); c.addPath(outer); c.fillPath() }
    c.setBlendMode(.clear)
    for p in cuts { c.addPath(p); c.fillPath() }
    c.setBlendMode(.normal)
    if accent(variant) {
        if variant == .primary { gradient(c, path: middle, colors: [mint, "3F7964"], from: CGPoint(x: 139, y: 232), to: CGPoint(x: 393, y: 232)) }
        else { c.setFillColor(color(variant == .light ? "27815F" : mint)); c.addPath(middle); c.fillPath() }
    }
    c.endTransparencyLayer(); c.restoreGState()
}
func drawTile(_ c: CGContext) {
    let tile = CGPath(roundedRect: CGRect(x: 24, y: 24, width: 464, height: 464), cornerWidth: 104, cornerHeight: 104, transform: nil)
    gradient(c, path: tile, colors: ["30383D", "11181C"], from: CGPoint(x: 90, y: 24), to: CGPoint(x: 420, y: 488))
    c.setStrokeColor(color("465158")); c.setLineWidth(1.5); c.addPath(tile); c.strokePath()
}
func makeContext(_ w: Int, _ h: Int) -> CGContext {
    let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.translateBy(x: 0, y: CGFloat(h)); c.scaleBy(x: 1, y: -1); return c
}
func savePNG(_ c: CGContext, _ name: String) throws {
    let dest = CGImageDestinationCreateWithURL(root.appendingPathComponent(name) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, c.makeImage()!, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("PNG export failed: \(name)") }
}
func svg(_ v: Variant, wordmark: Bool = false, tile: Bool = false) -> String {
    let w = wordmark ? 1450 : 512
    var s = """
    <svg xmlns="http://www.w3.org/2000/svg" width="\(w)" height="512" viewBox="0 0 \(w) 512" role="img" aria-labelledby="title"><title id="title">Ramble\(wordmark ? " wordmark" : " logo")</title><defs>
    <linearGradient id="ivory" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFFDF0"/><stop offset="1" stop-color="#D9D8CB"/></linearGradient>
    <linearGradient id="mint"><stop stop-color="#87E7B8"/><stop offset="1" stop-color="#3F7964"/></linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#30383D"/><stop offset="1" stop-color="#11181C"/></linearGradient>
    <mask id="cutouts" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="white"/>
    """
    for p in cuts { s += "<path d=\"\(svgPath(p))\" fill=\"black\"/>" }
    s += "</mask></defs>"
    if tile { s += "<rect x=\"24\" y=\"24\" width=\"464\" height=\"464\" rx=\"104\" fill=\"url(#tile)\" stroke=\"#465158\" stroke-width=\"1.5\"/>" }
    s += "<path d=\"\(svgPath(outer))\" fill=\"\(v == .primary ? "url(#ivory)" : "#" + fillColor(v))\" mask=\"url(#cutouts)\"/>"
    if accent(v) { s += "<path d=\"\(svgPath(middle))\" fill=\"\(v == .primary ? "url(#mint)" : "#" + (v == .light ? "27815F" : mint))\"/>" }
    if wordmark {
        let p = textPath("Ramble", size: 235, x: 500, baseline: 330, bold: true)
        s += "<path d=\"\(svgPath(p))\" fill=\"#\(v == .black ? "000000" : v == .white ? "FFFFFF" : v == .light ? ink : "F5F5F2")\"/>"
    }
    return s + "</svg>\n"
}
for v in Variant.allCases {
    for word in [false, true] {
        let name = "ramble-\(word ? "wordmark" : "mark")-\(v.rawValue)"
        try svg(v, wordmark: word).write(to: root.appendingPathComponent("svg/\(name).svg"), atomically: true, encoding: .utf8)
        let w = word ? 2900 : 2048, h = word ? 1024 : 2048
        let c = makeContext(w, h); c.scaleBy(x: CGFloat(h)/512, y: CGFloat(h)/512)
        drawMark(c, variant: v)
        if word { c.setFillColor(color(v == .black ? "000000" : v == .white ? "FFFFFF" : v == .light ? ink : "F5F5F2")); c.addPath(textPath("Ramble", size: 235, x: 500, baseline: 330, bold: true)); c.fillPath() }
        try savePNG(c, "png/\(name).png")
    }
}
try svg(.primary, tile: true).write(to: root.appendingPathComponent("svg/ramble-app-icon.svg"), atomically: true, encoding: .utf8)
for size in [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024] {
    let c = makeContext(size, size); c.scaleBy(x: CGFloat(size)/512, y: CGFloat(size)/512); drawTile(c); drawMark(c, variant: .primary)
    try savePNG(c, "app/ramble-\(size).png")
}
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let source = root.appendingPathComponent("app/ramble-\(pixels).png")
        let dest = root.appendingPathComponent("app/ramble.iconset/icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png")
        if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }; try fm.copyItem(at: source, to: dest)
    }
}
// A compact 1-bit-style silhouette for native template-image use (black artwork, transparent holes).
for size in [16, 18, 20, 24, 32, 36, 40, 48, 64] {
    let c = makeContext(size, size); c.scaleBy(x: CGFloat(size)/512, y: CGFloat(size)/512); drawMark(c, variant: .black)
    try savePNG(c, "app/ramble-template-\(size).png")
}
let board = makeContext(1600, 1120)
board.setFillColor(color("10171B")); board.fill(CGRect(x: 0, y: 0, width: 1600, height: 1120))
func label(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat = 22, fill: String = "A8B5BC") { board.setFillColor(color(fill)); board.addPath(textPath(text, size: size, x: x, baseline: y)); board.fillPath() }
label("Ramble", x: 64, y: 90, size: 44, fill: "F5F5F2"); label("Option 4 · Logo asset kit", x: 64, y: 126)
let choices: [(Variant, String)] = [(.primary, "Primary"), (.dark, "Flat / dark surface"), (.light, "Flat / light surface"), (.white, "Monochrome")]
for (i, item) in choices.enumerated() {
    let x = CGFloat(64 + i * 384)
    if item.0 == .light { board.setFillColor(color("F5F5F2")); board.fill(CGRect(x: x, y: 174, width: 320, height: 320)) }
    board.saveGState(); board.translateBy(x: x, y: 174); board.scaleBy(x: 320/512, y: 320/512); drawMark(board, variant: item.0); board.restoreGState()
    label(item.1, x: x, y: 532)
}
board.saveGState(); board.translateBy(x: 64, y: 596); board.scaleBy(x: 0.76, y: 0.76); drawMark(board, variant: .dark); board.setFillColor(color("F5F5F2")); board.addPath(textPath("Ramble", size: 235, x: 500, baseline: 330, bold: true)); board.fillPath(); board.restoreGState()
label("Outlined wordmark · transparent SVG + PNG", x: 64, y: 1032)
board.saveGState(); board.translateBy(x: 1240, y: 652); board.scaleBy(x: 260/512, y: 260/512); drawTile(board); drawMark(board, variant: .primary); board.restoreGState()
label("App icon", x: 1298, y: 962)
try savePNG(board, "ramble-brand-preview.png")
print("Exported vector, raster, app, template, and preview assets to \(root.path)")
