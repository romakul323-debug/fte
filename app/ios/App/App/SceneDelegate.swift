import UIKit
import Capacitor
import AVFoundation
import ReplayKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = VolnaBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}


// Своя «оболочка» Capacitor: подключает плагин звонка
class VolnaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VolnaCallPlugin())
    }
}

// «Служба звонка» для iOS.
// Весь звук звонка ведёт нативный код (AVAudioEngine + WebSocket), а не WebView:
// WebView iOS усыпляет, когда приложение свёрнуто, а нативный звук с UIBackgroundModes = audio
// продолжает работать в фоне и при заблокированном экране.
@objc(VolnaCallPlugin)
public class VolnaCallPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VolnaCallPlugin"
    public let jsName = "VolnaCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "caps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "screenStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "screenStop", returnType: CAPPluginReturnPromise)
    ]
    private var picker: RPSystemBroadcastPickerView?
    private var active = false

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption(_:)),
                                               name: AVAudioSession.interruptionNotification, object: nil)
        VolnaAudio.shared.onEvent = { [weak self] name, data in
            self?.notifyListeners(name, data: data)
        }
    }

    @objc func caps(_ call: CAPPluginCall) {
        call.resolve(["audio": true, "screen": true, "version": 2])
    }

    // Показ экрана: открываем системное окно «Запись экрана» с расширением Волны.
    // Кадры отправляет расширение VolnaScreen, а сервер показывает их всем в канале.
    @objc func screenStart(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let view = self.bridge?.viewController?.view else { call.reject("no view"); return }
            self.picker?.removeFromSuperview()
            let p = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
            p.preferredExtension = (Bundle.main.bundleIdentifier ?? "ru.volna.messenger") + ".VolnaScreen"
            p.showsMicrophoneButton = false
            p.alpha = 0.02
            view.addSubview(p)
            self.picker = p
            for sub in p.subviews {
                if let b = sub as? UIButton { b.sendActions(for: .allTouchEvents) }
            }
            call.resolve()
        }
    }

    // остановить трансляцию из приложения нельзя — это делает сервер, закрывая соединение расширения
    @objc func screenStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.picker?.removeFromSuperview()
            self.picker = nil
            call.resolve()
        }
    }

    // старый режим (звук через WebView) — оставлен для совместимости
    @objc func start(_ call: CAPPluginCall) {
        activate()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        active = false
        if !VolnaAudio.shared.active {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        call.resolve()
    }

    @objc func startAudio(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else {
            call.reject("bad url")
            return
        }
        let a = VolnaAudio.shared
        let leg = call.getString("leg") ?? ""
        let channelId = call.getString("channelId") ?? ""
        let selfId = call.getString("selfId") ?? ""
        let muted = call.getBool("muted") ?? false
        let deafened = call.getBool("deafened") ?? false
        let gate = anyDict(call.getObject("gate")) ?? [:]
        let vols = anyDict(call.getObject("vols")) ?? [:]
        DispatchQueue.main.async {
            a.applyState(muted: muted, deafened: deafened, gate: gate, vols: vols)
            a.start(url: url, leg: leg, channelId: channelId, selfId: selfId) { err, nomic in
                if let err = err { call.reject(err) } else { call.resolve(["nomic": nomic]) }
            }
        }
    }

    @objc func stopAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            VolnaAudio.shared.stop()
            call.resolve()
        }
    }

    @objc func setState(_ call: CAPPluginCall) {
        let a = VolnaAudio.shared
        a.applyState(muted: call.getBool("muted"), deafened: call.getBool("deafened"),
                     gate: anyDict(call.getObject("gate")), vols: anyDict(call.getObject("vols")))
        call.resolve()
    }

    @objc func status(_ call: CAPPluginCall) {
        let a = VolnaAudio.shared
        call.resolve(["active": a.active, "leg": a.leg, "channelId": a.channelId, "selfId": a.selfId,
                      "muted": a.isMuted, "deafened": a.isDeafened])
    }

    private func activate() {
        active = true
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat,
                                    options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            CAPLog.print("VolnaCall: audio session error \(error)")
        }
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard active, !VolnaAudio.shared.active,
              let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        activate()
        notifyListeners("resumed", data: [:])
    }
}

private func anyDict(_ o: JSObject?) -> [String: Any]? {
    guard let o = o else { return nil }
    var r: [String: Any] = [:]
    for (k, v) in o { r[k] = v }
    return r
}

// ---------- μ-law ----------
private let MULAW_DECODE: [Float] = (0..<256).map { i -> Float in
    let u = ~UInt8(i)
    let sign = u & 0x80, exp = Int((u >> 4) & 7), mant = Int(u & 0x0f)
    var s = ((mant << 3) + 132) << exp
    s -= 132
    return Float(sign != 0 ? -s : s) / 32768
}
@inline(__always) private func linToMulaw(_ x: Float) -> UInt8 {
    var s = Int(max(-1, min(1, x)) * 32767)
    let sign = s < 0 ? 0x80 : 0
    if sign != 0 { s = -s }
    s = min(32635, s + 132)
    var exp = 7
    var mask = 0x4000
    while (s & mask) == 0 && exp > 0 { exp -= 1; mask >>= 1 }
    let mant = (s >> (exp + 3)) & 0x0f
    return UInt8(~(sign | (exp << 4) | mant) & 0xff)
}

// ---------- шумодав: пропускает голос, отсекает короткие щелчки и тапы (как в веб-версии) ----------
private final class VoiceGate {
    var enabled = true, auto = true, manual: Float = -45, muted = false
    private var floor: Float = -60
    private var above = 0, hold = 0
    private let need = 3          // 3 блока по 8 мс ≈ 24 мс выше порога
    private let holdBlocks = 40   // ≈ 320 мс
    private var gain: Float = 0
    private let att: Float = 1 - exp(-1 / (0.004 * 16000))
    private let rel: Float = 1 - exp(-1 / (0.09 * 16000))
    private var delay = [Float](repeating: 0, count: 480) // 30 мс упреждения
    private var di = 0
    private(set) var isOpen = false

    // блок из 128 сэмплов 16 кГц, обрабатывается на месте
    func process(_ x: UnsafeMutablePointer<Float>, _ n: Int) {
        var sum: Float = 0
        for i in 0..<n { sum += x[i] * x[i] }
        let level = 10 * log10(sum / Float(n) + 1e-12)
        if level < floor { floor += (level - floor) * 0.5 } else { floor += min(0.018, (level - floor) * 0.003) }
        let thr = auto ? min(-22, max(-58, floor + 11)) : manual
        if level > thr { above += 1 } else { above = 0 }
        var open: Bool
        if !enabled { open = true }
        else if above >= need { open = true; hold = holdBlocks }
        else if hold > 0 && level > thr - 6 { open = true; hold -= 1 }
        else if hold > 0 { open = true; hold -= 2 }
        else { open = false }
        if muted { open = false }
        isOpen = open && level > -70
        let target: Float = open ? 1 : 0
        let len = delay.count
        for i in 0..<n {
            let v = x[i]
            let y = enabled ? delay[di] : v
            delay[di] = v
            di = (di + 1) % len
            gain += (target - gain) * (target > gain ? att : rel)
            x[i] = y * gain
        }
    }
}

// ---------- буфер против рывков для каждого собеседника ----------
private final class Jitter {
    private let size = 32000
    private let ring: UnsafeMutablePointer<Float>
    private var r = 0, w = 0, filled = 0
    private var started = false
    var lastRx: CFAbsoluteTime = 0
    var level: Float = 0
    init() {
        ring = UnsafeMutablePointer<Float>.allocate(capacity: size)
        ring.initialize(repeating: 0, count: size)
    }
    deinit { ring.deallocate() }
    func push(_ bytes: UnsafeRawBufferPointer) {
        var sum: Float = 0
        for b in bytes {
            let v = MULAW_DECODE[Int(b)]
            sum += v * v
            ring[w] = v
            w = (w + 1) % size
            if filled < size { filled += 1 } else { r = (r + 1) % size }
        }
        if bytes.count > 0 { level = sqrt(sum / Float(bytes.count)) }
        lastRx = CFAbsoluteTimeGetCurrent()
        // отстали больше чем на 0,4 с — догоняем
        if filled > 6400 {
            let drop = filled - 1920
            r = (r + drop) % size
            filled -= drop
        }
    }
    func mix(into out: UnsafeMutablePointer<Float>, _ n: Int, gain: Float) {
        if !started {
            if filled < 1280 { return } // подушка 80 мс
            started = true
        }
        for i in 0..<n {
            if filled == 0 { started = false; return }
            out[i] += ring[r] * gain
            r = (r + 1) % size
            filled -= 1
        }
    }
}

// ---------- звук звонка ----------
final class VolnaAudio: NSObject, URLSessionWebSocketDelegate {
    static let shared = VolnaAudio()
    var onEvent: ((String, [String: Any]) -> Void)?

    private(set) var active = false
    private(set) var leg = "", channelId = "", selfId = ""
    private var url: URL?

    private let lock = NSLock()
    private var muted = false, deafened = false
    private var vols: [String: Float] = [:]
    private var streams: [String: Jitter] = [:]
    private let gate = VoiceGate()
    var isMuted: Bool { lock.lock(); defer { lock.unlock() }; return muted }
    var isDeafened: Bool { lock.lock(); defer { lock.unlock() }; return deafened }

    private var engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private var converter: AVAudioConverter?
    private let fmt16 = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    private var hasMic = false
    private var block = [Float](repeating: 0, count: 128)
    private var blockN = 0
    private var outBytes = [UInt8]()
    private var meOpen = false

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var lostSince: CFAbsoluteTime?
    private var inFlight = 0
    private var ticks = 0
    private var lastRestart: CFAbsoluteTime = 0
    private var levelTimer: Timer?
    private var restartPending = false

    override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 15
        cfg.waitsForConnectivity = false
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: OperationQueue())
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(onRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(onReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        nc.addObserver(self, selector: #selector(onForeground(_:)), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    func applyState(muted m: Bool?, deafened d: Bool?, gate g: [String: Any]?, vols v: [String: Any]?) {
        lock.lock()
        if let m = m { muted = m; gate.muted = m }
        if let d = d { deafened = d }
        if let g = g {
            if let e = g["enabled"] as? Bool { gate.enabled = e }
            if let a = g["auto"] as? Bool { gate.auto = a }
            if let t = g["threshold"] as? NSNumber { gate.manual = t.floatValue }
        }
        if let v = v {
            var nv: [String: Float] = [:]
            for (k, x) in v { if let n = x as? NSNumber { nv[k] = n.floatValue } }
            vols = nv
        }
        lock.unlock()
    }

    // MARK: старт / стоп
    func start(url: URL, leg: String, channelId: String, selfId: String, done: @escaping (String?, Bool) -> Void) {
        stop()
        self.url = url
        self.leg = leg
        self.channelId = channelId
        self.selfId = selfId
        active = true
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard self.active, self.leg == leg else { done(nil, !granted); return }
                self.hasMic = granted
                if !granted { self.applyState(muted: true, deafened: nil, gate: nil, vols: nil) }
                do {
                    try self.startEngine()
                } catch {
                    // без микрофона пробуем хотя бы слушать
                    self.hasMic = false
                    do { try self.startEngine() } catch {
                        self.stop()
                        done("audio: \(error.localizedDescription)", !granted)
                        return
                    }
                }
                self.lostSince = nil
                self.connect()
                self.startLevels()
                done(nil, !granted || !self.hasMic)
            }
        }
    }

    func stop() {
        active = false
        levelTimer?.invalidate()
        levelTimer = nil
        let t = task
        task = nil
        t?.cancel(with: .normalClosure, reason: nil)
        stopEngine()
        lock.lock()
        streams.removeAll()
        outBytes.removeAll()
        blockN = 0
        lock.unlock()
        leg = ""
        channelId = ""
        selfId = ""
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
        try? s.setPreferredIOBufferDuration(0.02)
        try s.setActive(true)
    }

    private func startEngine() throws {
        try configureSession()
        stopEngine()
        engine = AVAudioEngine()
        if hasMic {
            let input = engine.inputNode
            // системное эхо- и шумоподавление, как в обычных звонках
            try? input.setVoiceProcessingEnabled(true)
            let inFmt = input.outputFormat(forBus: 0)
            if inFmt.sampleRate > 0 && inFmt.channelCount > 0 {
                converter = AVAudioConverter(from: inFmt, to: fmt16)
                converter?.downmix = true
                input.installTap(onBus: 0, bufferSize: 960, format: inFmt) { [weak self] buf, _ in
                    self?.captured(buf)
                }
            } else {
                hasMic = false
            }
        }
        let src = AVAudioSourceNode(format: fmt16) { [weak self] _, _, frameCount, abl -> OSStatus in
            self?.render(Int(frameCount), abl)
            return noErr
        }
        engine.attach(src)
        engine.connect(src, to: engine.mainMixerNode, format: fmt16)
        source = src
        NotificationCenter.default.addObserver(self, selector: #selector(onEngineConfig(_:)),
                                               name: .AVAudioEngineConfigurationChange, object: engine)
        engine.prepare()
        try engine.start()
    }

    private func stopEngine() {
        NotificationCenter.default.removeObserver(self, name: .AVAudioEngineConfigurationChange, object: engine)
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        if let s = source { engine.detach(s) }
        source = nil
        converter = nil
    }

    private func restartEngine() {
        guard active, !restartPending else { return }
        restartPending = true
        // не чаще раза в секунду — чтобы перезапуск не зациклился
        let wait = max(0.3, 1.0 - (CFAbsoluteTimeGetCurrent() - lastRestart))
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
            self.restartPending = false
            guard self.active else { return }
            self.lastRestart = CFAbsoluteTimeGetCurrent()
            let wantMic = AVAudioSession.sharedInstance().recordPermission == .granted
            self.hasMic = wantMic
            do { try self.startEngine() } catch {
                self.hasMic = false
                try? self.startEngine()
            }
        }
    }

    // MARK: микрофон → шумодав → μ-law → сервер
    private func captured(_ buf: AVAudioPCMBuffer) {
        guard active, let conv = converter else { return }
        let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / buf.format.sampleRate + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt16, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        _ = conv.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buf
        }
        guard err == nil, let ch = out.floatChannelData?[0] else { return }
        let n = Int(out.frameLength)
        lock.lock()
        let isMuted = muted
        var chunks: [Data] = []
        for i in 0..<n {
            block[blockN] = ch[i]
            blockN += 1
            if blockN == 128 {
                blockN = 0
                block.withUnsafeMutableBufferPointer { gate.process($0.baseAddress!, 128) }
                meOpen = gate.isOpen
                if !isMuted {
                    for v in block { outBytes.append(linToMulaw(v)) }
                    if outBytes.count >= 640 {
                        chunks.append(Data(outBytes[0..<640]))
                        outBytes.removeFirst(640)
                    }
                }
            }
        }
        if isMuted { outBytes.removeAll(keepingCapacity: true) }
        lock.unlock()
        for c in chunks { send(c) }
    }

    private func send(_ d: Data) {
        guard let t = task else { return }
        lock.lock()
        if inFlight > 30 { lock.unlock(); return } // сеть не успевает — пропускаем кусочек
        inFlight += 1
        lock.unlock()
        t.send(.data(d)) { [weak self] _ in
            guard let self = self else { return }
            self.lock.lock()
            self.inFlight = max(0, self.inFlight - 1)
            self.lock.unlock()
        }
    }

    // MARK: собеседники → динамик
    private func render(_ n: Int, _ abl: UnsafeMutablePointer<AudioBufferList>) {
        let list = UnsafeMutableAudioBufferListPointer(abl)
        guard let raw = list.first?.mData else { return }
        let out = raw.assumingMemoryBound(to: Float.self)
        for i in 0..<n { out[i] = 0 }
        lock.lock()
        if !deafened {
            for (id, st) in streams { st.mix(into: out, n, gain: vols[id] ?? 1) }
        }
        lock.unlock()
        for i in 0..<n { out[i] = max(-1, min(1, out[i])) }
        if list.count > 1 {
            for b in 1..<list.count {
                if let m = list[b].mData { memcpy(m, raw, n * MemoryLayout<Float>.size) }
            }
        }
    }

    private func incoming(_ d: Data) {
        guard d.count > 2 else { return }
        d.withUnsafeBytes { (p: UnsafeRawBufferPointer) in
            let idLen = Int(p[0])
            guard idLen > 0, d.count > 1 + idLen else { return }
            let id = String(decoding: UnsafeRawBufferPointer(rebasing: p[1..<(1 + idLen)]), as: UTF8.self)
            let payload = UnsafeRawBufferPointer(rebasing: p[(1 + idLen)...])
            lock.lock()
            let st: Jitter
            if let s = streams[id] { st = s } else { st = Jitter(); streams[id] = st }
            st.push(payload)
            lock.unlock()
        }
    }

    // MARK: соединение с сервером
    private func connect() {
        guard active, let url = url else { return }
        var req = URLRequest(url: url)
        req.setValue("VolnaApp/1.0", forHTTPHeaderField: "User-Agent")
        let t = session.webSocketTask(with: req)
        t.maximumMessageSize = 1 << 16
        task = t
        t.resume()
        receive(t)
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] res in
            guard let self = self, self.task === t else { return }
            switch res {
            case .success(let msg):
                if case .data(let d) = msg { self.incoming(d) }
                self.receive(t)
            case .failure:
                self.lost(t)
            }
        }
    }

    private func lost(_ t: URLSessionWebSocketTask) {
        DispatchQueue.main.async {
            guard self.active, self.task === t else { return }
            self.task = nil
            let code = (t.response as? HTTPURLResponse)?.statusCode ?? 0
            if t.closeCode.rawValue == 4000 || code == 404 { self.end("left"); return }
            // сервер держит место в звонке 25 секунд — пробуем вернуться
            let now = CFAbsoluteTimeGetCurrent()
            if self.lostSince == nil { self.lostSince = now }
            if now - (self.lostSince ?? now) > 24 { self.end("lost"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                if self.active && self.task == nil { self.connect() }
            }
        }
    }

    private func end(_ reason: String) {
        guard active else { return }
        stop()
        onEvent?("ended", ["reason": reason])
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol proto: String?) {
        DispatchQueue.main.async {
            if self.task === webSocketTask { self.lostSince = nil }
        }
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        lost(webSocketTask)
    }

    // MARK: кто говорит (для подсветки в интерфейсе)
    private func startLevels() {
        levelTimer?.invalidate()
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self = self, self.active else { return }
            let now = CFAbsoluteTimeGetCurrent()
            // проверка связи раз в 5 секунд: молча оборвавшееся соединение сразу переподключаем
            self.ticks += 1
            if self.ticks % 25 == 0, let t = self.task {
                t.sendPing { [weak self] err in if err != nil { self?.lost(t) } }
            }
            var ids: [String] = []
            self.lock.lock()
            for (id, st) in self.streams {
                if now - st.lastRx < 0.35 && st.level > 0.015 { ids.append(id) }
            }
            self.streams = self.streams.filter { now - $0.value.lastRx < 30 }
            let me = self.meOpen && !self.muted && self.hasMic
            self.lock.unlock()
            if UIApplication.shared.applicationState == .active {
                self.onEvent?("levels", ["ids": ids, "me": me])
            }
        }
    }

    // MARK: прерывания (звонок по сотовой, Siri, другие приложения, наушники)
    @objc private func onInterruption(_ note: Notification) {
        guard active, let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .ended { restartEngine() }
    }

    @objc private func onRouteChange(_ note: Notification) {
        guard active else { return }
        let s = AVAudioSession.sharedInstance()
        // кто-то (например, WebView) сменил режим звука — возвращаем режим разговора
        if s.category != .playAndRecord { restartEngine(); return }
        DispatchQueue.main.async { if self.active && !self.engine.isRunning { self.restartEngine() } }
    }

    @objc private func onEngineConfig(_ note: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            if self.active && !self.engine.isRunning { self.restartEngine() }
        }
    }
    @objc private func onReset(_ note: Notification) { restartEngine() }
    @objc private func onForeground(_ note: Notification) {
        guard active else { return }
        if !engine.isRunning { restartEngine() }
        if task == nil { connect() }
    }
}
