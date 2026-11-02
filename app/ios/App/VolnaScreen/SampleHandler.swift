import ReplayKit
import CoreImage
import Foundation

// Расширение «Волна» для системной записи экрана iPhone:
// берёт кадры экрана, сжимает в JPEG и отправляет на сервер Волны, а тот — зрителям в голосовом канале.
class SampleHandler: RPBroadcastSampleHandler, URLSessionWebSocketDelegate {
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private let ctx = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var inFlight = 0
    private var lastFrame: CFAbsoluteTime = 0
    private var lastSent: CFAbsoluteTime = 0
    private var lastJpeg: Data?
    private var timer: DispatchSourceTimer?
    private var opened = false
    private var finished = false
    private let maxShort: CGFloat = 720
    private let interval: CFAbsoluteTime = 1.0 / 12

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard let url = Self.screenURL() else {
            fail("Не найден адрес сервера Волны")
            return
        }
        session = URLSession(configuration: .default, delegate: self, delegateQueue: OperationQueue())
        var req = URLRequest(url: url)
        req.setValue("VolnaApp/1.0", forHTTPHeaderField: "User-Agent")
        let t = session.webSocketTask(with: req)
        t.maximumMessageSize = 1 << 20
        task = t
        t.resume()
        receive(t)
        // ReplayKit присылает кадры только когда экран меняется — повторяем последний, чтобы новые зрители сразу видели картинку
        let tm = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        tm.schedule(deadline: .now() + 1.5, repeating: 1.5)
        tm.setEventHandler { [weak self] in
            guard let self = self else { return }
            if CFAbsoluteTimeGetCurrent() - self.lastSent > 1.4, let d = self.lastJpeg { self.send(d) }
        }
        tm.resume()
        timer = tm
    }

    override func broadcastFinished() {
        finished = true
        timer?.cancel()
        task?.cancel(with: .normalClosure, reason: nil)
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with type: RPSampleBufferType) {
        guard type == .video, opened else { return }
        let now = CFAbsoluteTimeGetCurrent()
        guard now - lastFrame >= interval else { return }
        lock.lock()
        let busy = inFlight >= 3
        lock.unlock()
        if busy { return } // сеть не успевает — пропускаем кадр
        guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastFrame = now
        autoreleasepool {
            var img = CIImage(cvPixelBuffer: pb)
            if let o = CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber,
               let ori = CGImagePropertyOrientation(rawValue: o.uint32Value) {
                img = img.oriented(ori)
            }
            let ext = img.extent
            let scale = min(1, maxShort / max(1, min(ext.width, ext.height)))
            if scale < 1 { img = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
            img = img.transformed(by: CGAffineTransform(translationX: -img.extent.origin.x, y: -img.extent.origin.y))
            guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
                  let jpeg = ctx.jpegRepresentation(of: img, colorSpace: cs,
                                                    options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.5])
            else { return }
            lastJpeg = jpeg
            send(jpeg)
        }
    }

    private func send(_ d: Data) {
        guard let t = task else { return }
        lock.lock()
        inFlight += 1
        lock.unlock()
        lastSent = CFAbsoluteTimeGetCurrent()
        t.send(.data(d)) { [weak self] _ in
            guard let self = self else { return }
            self.lock.lock()
            self.inFlight = max(0, self.inFlight - 1)
            self.lock.unlock()
        }
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] res in
            guard let self = self, self.task === t else { return }
            switch res {
            case .success: self.receive(t)
            case .failure: self.lost(t)
            }
        }
    }

    private func lost(_ t: URLSessionWebSocketTask) {
        guard !finished, task === t else { return }
        task = nil
        let code = (t.response as? HTTPURLResponse)?.statusCode ?? 0
        if !opened || code == 404 {
            fail("Сначала нажми «Показать экран» в звонке в приложении Волна, потом начни трансляцию")
        } else {
            fail("Показ экрана остановлен")
        }
    }

    private func fail(_ text: String) {
        guard !finished else { return }
        finished = true
        timer?.cancel()
        finishBroadcastWithError(NSError(domain: "Volna", code: 1, userInfo: [NSLocalizedDescriptionKey: text]))
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol proto: String?) {
        opened = true
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        lost(webSocketTask)
    }

    // адрес сервера: из Info.plist расширения (вписывается при сборке), иначе — из настроек самого приложения
    private static func screenURL() -> URL? {
        var base = (Bundle.main.object(forInfoDictionaryKey: "VolnaServer") as? String) ?? ""
        if base.isEmpty {
            let appURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
            if let data = try? Data(contentsOf: appURL.appendingPathComponent("capacitor.config.json")),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let server = json["server"] as? [String: Any], let u = server["url"] as? String {
                base = u
            }
        }
        base = base.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") { base.removeLast() }
        guard !base.isEmpty else { return nil }
        if base.hasPrefix("https://") { base = "wss://" + base.dropFirst(8) }
        else if base.hasPrefix("http://") { base = "ws://" + base.dropFirst(7) }
        return URL(string: base + "/ns?claim=1")
    }
}
