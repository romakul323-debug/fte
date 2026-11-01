import SwiftUI
import UIKit
import UserNotifications

struct BoostLine: Identifiable {
    enum State { case ok, warn, work }
    let id = UUID()
    let title: String
    let value: String
    let state: State
    var hint: String? = nil
}

/// Напоминания о перегреве во время игры.
enum HeatReminder {
    static let ids = ["heat30", "heat60", "heat90"]

    static func request(_ done: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { ok, _ in
            DispatchQueue.main.async { done(ok) }
        }
    }

    static func schedule() {
        let c = UNUserNotificationCenter.current()
        c.removePendingNotificationRequests(withIdentifiers: ids)
        for (id, minutes) in zip(ids, [30, 60, 90]) {
            let content = UNMutableNotificationContent()
            content.title = "\(minutes) минут в игре"
            content.body = "Если iPhone горячий, дай ему минуту между катками — FPS перестанет проседать."
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(minutes * 60), repeats: false)
            c.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        }
    }

    static func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }
}

@MainActor
final class Booster: ObservableObject {
    enum Phase { case idle, running, done, launching }

    @Published var phase: Phase = .idle
    @Published var progress: Double = 0
    @Published var lines: [BoostLine] = []
    @Published var bestPing: (name: String, ms: Int)? = nil
    @Published var freedMB: Double? = nil
    @Published var launchNote: String? = nil

    @Published var autoLaunch: Bool { didSet { save(autoLaunch, "autoLaunch") } }
    @Published var heatReminder: Bool { didSet { save(heatReminder, "heatReminder") } }
    @Published var editionChoice: String { didSet { UserDefaults.standard.set(editionChoice, forKey: "edition") } }

    var active: Bool { phase != .idle }
    var edition: GameEdition { GameLauncher.edition(for: editionChoice) }

    private var task: Task<Void, Never>?
    private var didAuto = false
    private let haptic = UIImpactFeedbackGenerator(style: .medium)

    init() {
        let d = UserDefaults.standard
        autoLaunch = d.object(forKey: "autoLaunch") as? Bool ?? true
        heatReminder = d.bool(forKey: "heatReminder")
        editionChoice = d.string(forKey: "edition") ?? "auto"
    }

    private func save(_ v: Bool, _ key: String) { UserDefaults.standard.set(v, forKey: key) }

    func autoStartIfNeeded(monitor: SystemMonitor) {
        guard !didAuto else { return }
        didAuto = true
        Task {
            await GameLauncher.resolveBundleIDs()
        }
        guard autoLaunch else { return }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 900_000_000)   // сначала показываем главный экран
            self?.start(monitor: monitor)
        }
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

            let hot = m.thermal == .serious || m.thermal == .critical
            await self.add(0.12, BoostLine(title: "Нагрев", value: m.thermalText, state: hot ? .warn : .ok,
                                           hint: hot ? "Дай iPhone остыть пару минут, сними чехол" : nil))

            await self.add(0.22, BoostLine(title: "Энергосбережение", value: m.lowPower ? "включено" : "выключено",
                                           state: m.lowPower ? .warn : .ok,
                                           hint: m.lowPower ? "Выключи в Пункте управления — режет FPS\(m.hasProMotion ? " и экран до 60 Гц" : "")" : nil))

            // очистка ОЗУ
            let ramIndex = await self.add(0.30, BoostLine(title: "Очистка ОЗУ", value: "освобождаю…", state: .work))
            let ram = await RAMCleaner.purge()
            if Task.isCancelled { return }
            let gained = ram.afterMB - ram.beforeMB
            self.freedMB = max(0, gained)
            self.replace(ramIndex, BoostLine(
                title: "Очистка ОЗУ",
                value: gained > 50 ? "+\(Int(gained)) МБ · \(RAMCleaner.gb(ram.afterMB)) своб." : "\(RAMCleaner.gb(ram.afterMB)) свободно",
                state: .ok))
            self.bump(0.52)

            // пинг
            let pingIndex = await self.add(0.56, BoostLine(title: "Пинг", value: "замер…", state: .work))
            async let msk = PingTester.measure(host: "ya.ru")
            async let fra = PingTester.measure(host: "ec2.eu-central-1.amazonaws.com")
            async let sto = PingTester.measure(host: "ec2.eu-north-1.amazonaws.com")
            async let seo = PingTester.measure(host: "ec2.ap-northeast-2.amazonaws.com")
            let all: [(String, PingResult?)] = [("Москва", await msk), ("Европа", await fra), ("Стокгольм", await sto), ("Корея", await seo)]
            if Task.isCancelled { return }
            let results = all.compactMap { pair -> (String, PingResult)? in
                guard let r = pair.1 else { return nil }
                return (pair.0, r)
            }
            if let best = results.min(by: { $0.1.avg < $1.1.avg }) {
                let ms = Int(best.1.avg)
                self.bestPing = (best.0, ms)
                let bad = ms > 120 || best.1.jitter > 25
                self.replace(pingIndex, BoostLine(title: "Пинг", value: "\(ms) мс · \(best.0)", state: bad ? .warn : .ok,
                                                  hint: bad ? "Подойди к роутеру, выключи VPN и загрузки" : nil))
            } else {
                self.replace(pingIndex, BoostLine(title: "Пинг", value: "нет сети", state: .warn, hint: "Проверь интернет"))
            }
            self.bump(0.78)

            let profile = Profile.recommended(for: m.model.tier)
            let s = Recommender.settings(profile, tier: m.model.tier, hz: m.screenHz)
            let gfx = s.rows.first { $0.name == "Графика" }?.value ?? ""
            let fps = s.rows.first { $0.name == "Частота кадров" }?.value ?? ""
            await self.add(0.9, BoostLine(title: "Графика", value: "\(gfx) · \(fps)", state: .ok))

            let e = self.edition
            let installed = GameLauncher.isInstalled(e)
            await self.add(1.0, BoostLine(title: "PUBG \(e.name)", value: installed == false ? "не найдена" : "готова",
                                          state: installed == false ? .warn : .ok,
                                          hint: installed == false ? "Выбери другую версию в настройках" : nil))

            if Task.isCancelled { return }
            self.phase = .done
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            m.refresh()
            try? await Task.sleep(nanoseconds: 1_100_000_000)
            if Task.isCancelled || !self.autoLaunch { return }
            self.launch()
        }
    }

    func launch() {
        phase = .launching
        haptic.impactOccurred(intensity: 1)
        if heatReminder { HeatReminder.schedule() }
        let e = edition
        GameLauncher.launch(e) { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                if result == .appStore {
                    self.launchNote = "iOS не дал открыть игру напрямую — открыл PUBG \(e.name) в App Store, жми «Открыть»."
                }
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                if self.phase == .launching { self.phase = .idle }
            }
        }
    }

    // MARK: шаги

    @discardableResult
    private func add(_ p: Double, _ line: BoostLine) async -> Int {
        try? await Task.sleep(nanoseconds: 380_000_000)
        withAnimation(.easeOut(duration: 0.25)) {
            lines.append(line)
            progress = p
        }
        haptic.impactOccurred(intensity: line.state == .warn ? 0.9 : 0.4)
        return lines.count - 1
    }

    private func replace(_ i: Int, _ line: BoostLine) {
        guard lines.indices.contains(i) else { return }
        withAnimation(.easeOut(duration: 0.2)) { lines[i] = line }
        haptic.impactOccurred(intensity: 0.5)
    }

    private func bump(_ p: Double) {
        withAnimation(.easeOut(duration: 0.4)) { progress = p }
    }
}
