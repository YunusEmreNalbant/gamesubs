// GameSubs Mac OCR: bir pencerenin altyazı bölgesini yakalar, Apple Vision ile okur.
// Kararlı (birkaç karede aynı) metni yazdırır. --json ile her satır bir JSON olayıdır.
//   gl-ocr --list
//   gl-ocr --app "RemotePlay" [--region 0.65,1.0] [--fps 8] [--stable 2] [--json] [--shot out.png]
//   gl-ocr --app "RemotePlay" --bench 40 [--full-capture] [--no-skip]     # hız ölçümü
import Foundation
import ScreenCaptureKit
import Vision
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import AppKit

_ = NSApplication.shared          // CoreGraphics/WindowServer bağlantısı (aksi halde CGS_REQUIRE_INIT çöker)
setvbuf(stdout, nil, _IOLBF, 0)

// MARK: - Argümanlar ve çıktı

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}
func has(_ n: String) -> Bool { CommandLine.arguments.contains(n) }
func fail(_ m: String) -> Never { FileHandle.standardError.write(Data((m + "\n").utf8)); exit(1) }

let jsonOut = has("--json")
let clock: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"; return f }()
func emit(_ type: String, _ text: String = "", _ extra: [String: Any] = [:]) {
    if jsonOut {
        var o: [String: Any] = ["type": type, "text": text]; extra.forEach { o[$0] = $1 }
        if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s) }
    } else {
        print("[\(clock.string(from: Date()))] \(type) \(text) \(extra.isEmpty ? "" : "\(extra)")")
    }
}
func ms(since t: Date) -> Double { Date().timeIntervalSince(t) * 1000 }

// MARK: - Pencere seçimi

let content: SCShareableContent
do { content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) }
catch { fail("Ekran kaydı izni yok ya da alınamadı: \(error.localizedDescription)") }

if has("--list") {
    for w in content.windows where w.frame.width > 200 {
        print("\(w.windowID)\t\(w.owningApplication?.applicationName ?? "?")\t\(w.title ?? "")\t\(Int(w.frame.width))x\(Int(w.frame.height))")
    }
    exit(0)
}

guard let appName = arg("--app") else { fail("--app \"<uygulama adı>\" gerekli (önce --list)") }
func norm(_ s: String) -> String { s.lowercased().filter { $0.isLetter || $0.isNumber } }
let want = norm(appName)
let candidates = content.windows.filter {
    let hay = norm(($0.owningApplication?.applicationName ?? "") + ($0.owningApplication?.bundleIdentifier ?? "") + ($0.title ?? ""))
    return hay.contains(want) && $0.frame.width > 300
}
guard let win = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
    fail("'\(appName)' penceresi bulunamadı. Görünen pencereler:\n" + content.windows.filter { $0.frame.width > 200 }.map { "  \($0.owningApplication?.applicationName ?? "?") | \($0.title ?? "") | \(Int($0.frame.width))x\(Int($0.frame.height))" }.joined(separator: "\n"))
}

// MARK: - Ayarlar

let reg = (arg("--region") ?? "0.65,1.0").split(separator: ",").compactMap { Double($0) }
let (top, bottom) = (reg.count == 2 ? reg[0] : 0.65, reg.count == 2 ? reg[1] : 1.0)
let fps = Double(arg("--fps") ?? "8") ?? 8
let needStable = Int(arg("--stable") ?? "2") ?? 2
let clearAfter = 8                       // bu kadar ardışık boş kare → altyazı bitti
let shotPath = arg("--shot")
let benchFrames = Int(arg("--bench") ?? "0") ?? 0
let fullCapture = has("--full-capture") // karşılaştırma için: eski davranış (tüm pencere)
let skipUnchanged = !has("--no-skip")

// Yalnızca altyazı bölgesini yakala (piksel sayısı ~%65 azalır). sourceRect pencere içi noktalar cinsindendir.
let scale: CGFloat = 2                   // Retina
let regionPts = CGRect(x: 0, y: win.frame.height * top, width: win.frame.width, height: win.frame.height * (bottom - top))
let cfg = SCStreamConfiguration()
cfg.showsCursor = false
if fullCapture {
    cfg.width = Int(win.frame.width * scale); cfg.height = Int(win.frame.height * scale)
} else {
    cfg.sourceRect = regionPts
    cfg.width = Int(regionPts.width * scale); cfg.height = Int(regionPts.height * scale)
}
let filter = SCContentFilter(desktopIndependentWindow: win)

/// Devam ettirmeyi (continuation) tam bir kez çağırır: yakalama ya da zaman aşımı, hangisi önce gelirse.
final class Once<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var k: CheckedContinuation<T, Error>?
    init(_ k: CheckedContinuation<T, Error>) { self.k = k }
    func finish(_ r: Result<T, Error>) {
        lock.lock(); let c = k; k = nil; lock.unlock()
        c?.resume(with: r)
    }
}

/// macOS yakalama isteğine bazen hiç cevap vermiyor (pencere kapandı/yeniden açıldı ya da servis takıldı).
/// Sonsuza dek beklemek yerine zaman aşımıyla hata ver; üst döngü art arda hatada süreci kapatır.
let grabTimeout: Double = 3
func grab() async throws -> CGImage {
    let f = filter, c = cfg
    return try await withCheckedThrowingContinuation { (k: CheckedContinuation<CGImage, Error>) in
        let once = Once(k)
        SCScreenshotManager.captureImage(contentFilter: f, configuration: c) { image, error in
            if let image = image { once.finish(.success(image)) }
            else { once.finish(.failure(error ?? NSError(domain: "gl-ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "görüntü alınamadı"]))) }
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + grabTimeout) {
            once.finish(.failure(NSError(domain: "gl-ocr", code: 2, userInfo: [NSLocalizedDescriptionKey: "yakalama \(Int(grabTimeout)) sn içinde cevap vermedi"])))
        }
    }
}

/// Yakalanan görüntüden altyazı bölgesi (sourceRect kullanılıyorsa zaten bölgedir).
func region(_ img: CGImage) -> CGImage {
    guard fullCapture else { return img }
    let h = CGFloat(img.height)
    return img.cropping(to: CGRect(x: 0, y: h * top, width: CGFloat(img.width), height: h * (bottom - top))) ?? img
}

// MARK: - Değişiklik algılama (OCR'ı atlamak için)

/// Tam çözünürlükte her `step`. pikseli (ortalama ALMADAN) örnekler. Küçültme ortalama aldığı için tek harflik
/// değişimi siliyordu; seyrek örnekleme harfin keskin kenarlarını korur. Belirgin değişen örnek yoksa OCR atlanır.
final class ChangeDetector {
    private let step = 4
    private var prev: [UInt8]?
    private var prevSize = (0, 0)
    func changed(_ img: CGImage) -> Bool {
        guard img.bitsPerPixel == 32, let data = img.dataProvider?.data, let base = CFDataGetBytePtr(data) else { return true }
        let w = img.width, h = img.height, bpr = img.bytesPerRow
        var cur = [UInt8](); cur.reserveCapacity((w / step + 1) * (h / step + 1))
        var y = 0
        while y < h {
            var x = 0
            let row = base + y * bpr
            while x < w { cur.append(row[x * 4 + 1]); x += step }   // yeşil kanal ≈ parlaklık
            y += step
        }
        defer { prev = cur; prevSize = (w, h) }
        guard let p = prev, prevSize == (w, h), p.count == cur.count else { return true }
        var changedSamples = 0
        for i in 0..<cur.count where abs(Int(cur[i]) - Int(p[i])) > 40 {
            changedSamples += 1
            if changedSamples >= 6 { return true }                    // erken çık
        }
        return false
    }
}

// MARK: - OCR

let request: VNRecognizeTextRequest = {
    let r = VNRecognizeTextRequest()
    r.recognitionLevel = .accurate
    r.recognitionLanguages = ["en-US"]
    r.usesLanguageCorrection = true
    return r
}()

/// Altyazı satırlarını okur: düşük güven, çok kısa/sembolik ve kenara yakın (düğme ipucu) satırları eler,
/// en alttaki yazı kümesini (altyazı) döndürür.
func ocr(_ c: CGImage) throws -> String {
    try VNImageRequestHandler(cgImage: c, options: [:]).perform([request])
    var lines: [(y: CGFloat, h: CGFloat, s: String)] = []
    for o in request.results ?? [] {
        guard let cand = o.topCandidates(1).first, cand.confidence > 0.5 else { continue }
        let letters = cand.string.filter { $0.isLetter }.count
        let midX = o.boundingBox.midX
        if letters < 4 || midX < 0.15 || midX > 0.85 { continue }
        lines.append((o.boundingBox.midY, o.boundingBox.height, cand.string))
    }
    // Altyazı ekranın en altındaki yazı kümesidir: en alttan başla, yakın satırları ekle,
    // aradaki boşluk büyükse (eğitim ipucu vb.) kümeyi kes.
    let bottomUp = lines.sorted { $0.y < $1.y }
    guard let first = bottomUp.first else { return "" }
    var cluster = [first]
    for l in bottomUp.dropFirst() {
        let prev = cluster.last!
        if l.y - prev.y < max(prev.h, l.h) * 2.2 { cluster.append(l) } else { break }
    }
    return cluster.sorted { $0.y > $1.y }.map { $0.s }.joined(separator: " ")
}

func savePNG(_ img: CGImage, _ path: String) {
    let url = URL(fileURLWithPath: path)
    if let d = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) {
        CGImageDestinationAddImage(d, img, nil); CGImageDestinationFinalize(d)
    }
}

// MARK: - Ana döngü

// Isınma: ilk doğru-mod OCR çağrısı onlarca saniye sürebilir (model hazırlığı).
emit("status", "isiniyor")
let t0 = Date()
do { let warm = try await grab(); _ = try? ocr(region(warm)) }
catch { emit("error", "ilk yakalama başarısız: \(error.localizedDescription)"); exit(3) }
emit("status", "hazir", ["warmupMs": Int(ms(since: t0))])

let detector = ChangeDetector()
var candidate = "", candidateCount = 0, shown = "", emptyCount = 0, savedShot = false, lastText = ""
var benchCap = 0.0, benchOcr = 0.0, benchOcrRuns = 0, benchN = 0, benchSkipped = 0
var captureFailures = 0
let maxCaptureFailures = 5           // art arda bu kadar yakalama hatası → çık (köprü yeniden başlatır, pencereyi yeniden seçer)

while true {
    let loopStart = Date()
    do {
        let tCap = Date()
        let img: CGImage
        do { img = try await grab(); captureFailures = 0 }
        catch {
            captureFailures += 1
            emit("error", "\(error.localizedDescription) (\(captureFailures)/\(maxCaptureFailures))")
            if captureFailures >= maxCaptureFailures { emit("error", "yakalama art arda başarısız, çıkılıyor"); exit(3) }
            throw error
        }
        let capMs = ms(since: tCap)
        let crop = region(img)
        if let p = shotPath, !savedShot {
            savePNG(img, p.replacingOccurrences(of: ".png", with: "-capture.png"))
            savePNG(crop, p.replacingOccurrences(of: ".png", with: "-crop.png"))
            savedShot = true
        }

        // Görüntü değişmediyse OCR'ı atla, önceki okumayı kullan (kararlılık sayımı yine ilerler).
        var ocrMs = 0.0
        let text: String
        if skipUnchanged && !detector.changed(crop) {
            text = lastText; benchSkipped += 1
        } else {
            let tOcr = Date()
            text = try ocr(crop)
            ocrMs = ms(since: tOcr); benchOcr += ocrMs; benchOcrRuns += 1
            lastText = text
        }

        if benchFrames > 0 {
            benchCap += capMs; benchN += 1
            if benchN >= benchFrames {
                let avgOcr = benchOcrRuns > 0 ? benchOcr / Double(benchOcrRuns) : 0
                print(String(format: "BENCH kare=%d | yakalama ort %.1f ms | OCR çalıştı %d kez, ort %.1f ms | atlanan %d | yakalanan %dx%d",
                             benchN, benchCap / Double(benchN), benchOcrRuns, avgOcr, benchSkipped, img.width, img.height))
                exit(0)
            }
        }

        if text.isEmpty {
            emptyCount += 1; candidate = ""; candidateCount = 0
            if emptyCount == clearAfter && !shown.isEmpty { shown = ""; emit("clear") }
        } else {
            emptyCount = 0
            // Kararlılık: küçük okuma farklarını yok say (harf/rakam dışını at, küçük harfe çevir).
            if norm(text) == norm(candidate) { candidateCount += 1 } else { candidate = text; candidateCount = 1 }
            if candidateCount == needStable && norm(candidate) != norm(shown) {
                shown = candidate
                emit("subtitle", candidate, ["captureMs": Int(capMs), "ocrMs": Int(ocrMs)])
            }
        }
    } catch { if (error as NSError).domain != "gl-ocr" { emit("error", error.localizedDescription) } }
    let wait = 1.0 / fps - Date().timeIntervalSince(loopStart)
    if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
}
