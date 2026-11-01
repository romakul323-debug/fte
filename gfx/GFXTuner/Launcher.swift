import SwiftUI
import UIKit
import ObjectiveC

// MARK: - Запуск PUBG

/// Открывает PUBG напрямую по ID приложения (как это делают лаунчеры для сайдлоада),
/// запасной путь — ссылки игры, последний — страница игры в App Store.
enum GameLauncher {
    /// Глобальная, BGMI (Индия), Корея, Вьетнам, Тайвань.
    static let bundleIDs = ["com.tencent.ig", "com.pubg.imobile", "com.pubg.krmobile", "com.vng.pubgmobile", "com.rekoo.pubgm"]
    static let schemes = ["pubgmobile://", "pubgm://"]
    static let appStore = URL(string: "https://apps.apple.com/app/id1330123889")!

    enum Result { case opened, appStore }

    static func launch(_ done: @escaping (Result) -> Void) {
        if openByBundleID() { done(.opened); return }
        tryScheme(0, done)
    }

    private static func tryScheme(_ i: Int, _ done: @escaping (Result) -> Void) {
        guard i < schemes.count, let url = URL(string: schemes[i]) else {
            UIApplication.shared.open(appStore)
            done(.appStore)
            return
        }
        UIApplication.shared.open(url, options: [:]) { ok in
            if ok { done(.opened) } else { tryScheme(i + 1, done) }
        }
    }

    private static var workspace: NSObject? {
        guard let cls = NSClassFromString("LSApplicationWorkspace") else { return nil }
        let sel = NSSelectorFromString("defaultWorkspace")
        guard let method = class_getClassMethod(cls, sel) else { return nil }
        typealias Fn = @convention(c) (AnyClass, Selector) -> Unmanaged<AnyObject>?
        let fn = unsafeBitCast(method_getImplementation(method), to: Fn.self)
        return fn(cls, sel)?.takeUnretainedValue() as? NSObject
    }

    private static func call(_ ws: NSObject, _ name: String, _ id: String) -> Bool? {
        let sel = NSSelectorFromString(name)
        guard ws.responds(to: sel) else { return nil }
        typealias Fn = @convention(c) (AnyObject, Selector, NSString) -> Bool
        let fn = unsafeBitCast(ws.method(for: sel), to: Fn.self)
        return fn(ws, sel, id as NSString)
    }

    static func openByBundleID() -> Bool {
        guard let ws = workspace else { return false }
        // сначала установленные версии игры
        let installed = bundleIDs.filter { call(ws, "applicationIsInstalled:", $0) ?? true }
        for id in installed {
            if call(ws, "openApplicationWithBundleID:", id) == true { return true }
        }
        return false
    }
}

// MARK: - Буст: реальные проверки + запуск

struct BoostLine: Identifiable {
    enum State { case ok, warn, info }
    let id = UUID()
    let icon: String
    let title: String
    let value: String
    let state: State
    var hint: String? = nil
}

@MainActor
final class Booster: ObservableObject {
    enum Phase { case idle, running, done, launching }

    @Published var phase: Phase = .idle
    @Published var progress: Double = 0
    @Published var lines: [BoostLine] = []
    @Published var bestPing: (name: String, ms: Int)? = nil
    @Published var launchNote: String? = nil
    @Published var autoLaunch: Bool {
        didSet { UserDefaults.standard.set(autoLaunch, forKey: "autoLaunch") }
    }

    var active: Bool { phase != .idle }

    private var task: Task<Void, Never>?
    private var didAuto = false
    private let haptic = UIImpactFeedbackGenerator(style: .heavy)

    init() {
        autoLaunch = UserDefaults.standard.object(forKey: "autoLaunch") as? Bool ?? true
    }

    func autoStartIfNeeded(monitor: SystemMonitor) {
        guard autoLaunch, !didAuto else { return }
        didAuto = true
        start(monitor: monitor)
    }

    func cancel() {
        task?.cancel()
        phase = .idle
    }

    func start(monitor m: SystemMonitor) {
        task?.cancel()
        lines = []
        progress = 0
        launchNote = nil
        phase = .running
        haptic.prepare()
        task = Task { [weak self] in
            guard let self else { return }
            m.refresh()

            await self.step(0.12, BoostLine(icon: "eye.fill", title: "Пробуждение", value: m.model.name, state: .info))

            let hot = m.thermal == .serious || m.thermal == .critical
            await self.step(0.26, BoostLine(icon: "thermometer.medium", title: "Нагрев", value: m.thermalText,
                                            state: hot ? .warn : .ok,
                                            hint: hot ? "Дай iPhone остыть пару минут, сними чехол" : nil))

            await self.step(0.40, BoostLine(icon: "bolt.fill", title: "Энергосбережение", value: m.lowPower ? "ВКЛ" : "выкл",
                                            state: m.lowPower ? .warn : .ok,
                                            hint: m.lowPower ? "Выключи в Пункте управления — оно режет FPS" : nil))

            await self.step(0.52, BoostLine(icon: "display", title: "Экран", value: "\(m.screenHz) Гц", state: .ok))

            let lowSpace = m.totalGB > 0 && m.freeGB < 3
            await self.step(0.62, BoostLine(icon: "internaldrive.fill", title: "Память", value: String(format: "%.0f ГБ свободно", m.freeGB),
                                            state: lowSpace ? .warn : .ok,
                                            hint: lowSpace ? "Освободи место, игре нужно хотя бы 3 ГБ" : nil))

            // пинг — реальный замер
            self.lines.append(BoostLine(icon: "dot.radiowaves.left.and.right", title: "Пинг", value: "замер…", state: .info))
            let pingIndex = self.lines.count - 1
            async let msk = PingTester.measure(host: "ya.ru")
            async let fra = PingTester.measure(host: "ec2.eu-central-1.amazonaws.com")
            async let sto = PingTester.measure(host: "ec2.eu-north-1.amazonaws.com")
            let results = [("Москва", await msk), ("Франкфурт", await fra), ("Стокгольм", await sto)]
                .compactMap { name, r in r.map { (name, $0) } }
            if Task.isCancelled { return }
            if let best = results.min(by: { $0.1.avg < $1.1.avg }) {
                let ms = Int(best.1.avg)
                self.bestPing = (best.0, ms)
                let bad = ms > 120 || best.1.jitter > 25
                self.lines[pingIndex] = BoostLine(icon: "dot.radiowaves.left.and.right", title: "Пинг",
                                                  value: "\(ms) мс · \(best.0)", state: bad ? .warn : .ok,
                                                  hint: bad ? "Подойди к роутеру или выключи VPN" : nil)
            } else {
                self.lines[pingIndex] = BoostLine(icon: "dot.radiowaves.left.and.right", title: "Пинг", value: "нет сети",
                                                  state: .warn, hint: "Проверь интернет")
            }
            self.haptic.impactOccurred(intensity: 0.7)
            withAnimation(.easeOut(duration: 0.4)) { self.progress = 0.82 }

            let profile = Profile.recommended(for: m.model.tier)
            let s = Recommender.settings(profile, tier: m.model.tier, hz: m.screenHz)
            let gfx = s.rows.first { $0.name == "Графика" }?.value ?? ""
            let fps = s.rows.first { $0.name == "Частота кадров" }?.value ?? ""
            await self.step(1.0, BoostLine(icon: "slider.horizontal.3", title: "Графика в PUBG", value: "\(gfx) · \(fps)", state: .info))

            if Task.isCancelled { return }
            self.phase = .done
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            try? await Task.sleep(nanoseconds: 1_300_000_000)
            if Task.isCancelled || !self.autoLaunch { return }
            self.launch()
        }
    }

    func launch() {
        phase = .launching
        haptic.impactOccurred(intensity: 1)
        GameLauncher.launch { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                if result == .appStore {
                    self.launchNote = "iOS не дал открыть PUBG напрямую — открыл игру в App Store, жми «Открыть»."
                }
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if self.phase == .launching { self.phase = .idle }
            }
        }
    }

    private func step(_ p: Double, _ line: BoostLine) async {
        try? await Task.sleep(nanoseconds: 420_000_000)
        if Task.isCancelled { return }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
            lines.append(line)
            progress = p
        }
        haptic.impactOccurred(intensity: line.state == .warn ? 1 : 0.5)
    }
}
