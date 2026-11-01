import SwiftUI
import UIKit
import UserNotifications

struct BoostLine: Identifiable {
    enum State { case ok, warn, work, info }
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

enum BoostAction: String {
    case ram, lag, freeze, launch

    var title: String {
        switch self {
        case .ram: return "ОЧИСТКА ОЗУ"
        case .lag: return "УБИРАЮ ЛАГИ"
        case .freeze: return "АНТИ-ФРИЗ"
        case .launch: return "ЗАЛЁТ"
        }
    }
}

@MainActor
final class Booster: ObservableObject {
    enum Phase { case idle, running, done, launching }

    @Published var phase: Phase = .idle
    @Published var action: BoostAction = .launch
    @Published var progress: Double = 0
    @Published var lines: [BoostLine] = []
    @Published var launchNote: String? = nil

    // последние результаты — показываются на плитках
    @Published var bestPing: (name: String, ms: Int)? = nil
    @Published var freedMB: Double? = nil
    @Published var freezeHint: String? = nil

    @Published var autoLaunch: Bool { didSet { save(autoLaunch, "autoLaunch2") } }
    @Published var heatReminder: Bool { didSet { save(heatReminder, "heatReminder") } }
    @Published var editionChoice: String { didSet { UserDefaults.standard.set(editionChoice, forKey: "edition2") } }

    var active: Bool { phase != .idle }
    var edition: GameEdition { GameLauncher.edition(for: editionChoice) }

    private var task: Task<Void, Never>?
    private var didAuto = false
    private let haptic = UIImpactFeedbackGenerator(style: .medium)

    init() {
        let d = UserDefaults.standard
        autoLaunch = d.bool(forKey: "autoLaunch2")            // по умолчанию выключен
        heatReminder = d.bool(forKey: "heatReminder")
        editionChoice = d.string(forKey: "edition2") ?? "kr"  // по умолчанию Корея
    }

    private func save(_ v: Bool, _ key: String) { UserDefaults.standard.set(v, forKey: key) }

    func onEnter(monitor: SystemMonitor) {
        guard !didAuto else { return }
        didAuto = true
        Task { await GameLauncher.resolveBundleIDs() }
        if autoLaunch { run(.launch, monitor: monitor) }
    }

    func cancel() {
        task?.cancel()
        phase = .idle
    }

    func run(_ a: BoostAction, monitor m: SystemMonitor) {
        task?.cancel()
        action = a
        lines = []
        progress = 0
        launchNote = nil
        phase = .running
        haptic.prepare()
        task = Task { [weak self] in
            guard let self else { return }
            m.refresh()
            switch a {
            case .ram: await self.ramSteps(m, from: 0, to: 1)
            case .lag: await self.lagSteps(m, from: 0, to: 1)
            case .freeze: await self.freezeSteps(m, from: 0, to: 1)
            case .launch:
                await self.quickChecks(m)
                await self.ramSteps(m, from: 0.3, to: 0.85)
            }
            if Task.isCancelled { return }
            await self.add(1.0, BoostLine(title: "Готово", value: "", state: .info))
            self.phase = .done
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            m.refresh()
            if a == .launch {
                try? await Task.sleep(nanoseconds: 700_000_000)
                if Task.isCancelled { return }
                self.launch()
            }
        }
    }

    // MARK: шаги

    private func quickChecks(_ m: SystemMonitor) async {
        let hot = m.thermal == .serious || m.thermal == .critical
        await add(0.1, BoostLine(title: "Нагрев", value: m.thermalText, state: hot ? .warn : .ok,
                                 hint: hot ? "Дай iPhone остыть пару минут — иначе фризы" : nil))
        if m.lowPower {
            await add(0.2, BoostLine(title: "Энергосбережение", value: "включено", state: .warn,
                                     hint: "Выключи в Пункте управления — режет FPS"))
        }
    }

    private func ramSteps(_ m: SystemMonitor, from p0: Double, to p1: Double) async {
        let before = RAMCleaner.freeMB()
        await add(p0 + (p1 - p0) * 0.2, BoostLine(title: "Свободно сейчас", value: RAMCleaner.gb(before), state: .info))
        let i = await add(p0 + (p1 - p0) * 0.35, BoostLine(title: "Выгружаю фоновые", value: "…", state: .work))
        let r = await RAMCleaner.purge()
        if Task.isCancelled { return }
        let gained = max(0, r.afterMB - r.beforeMB)
        freedMB = gained
        replace(i, BoostLine(title: "Выгружаю фоновые", value: gained > 30 ? "+\(Int(gained)) МБ" : "уже чисто", state: .ok))
        bump(p0 + (p1 - p0) * 0.85)
        await add(p1, BoostLine(title: "Свободно для игры", value: RAMCleaner.gb(r.afterMB), state: .ok))
    }

    private func lagSteps(_ m: SystemMonitor, from p0: Double, to p1: Double) async {
        await add(0.08, BoostLine(title: "Сеть", value: m.netType, state: m.online ? .ok : .warn,
                                  hint: m.online ? (m.netType == "Сотовая" ? "Wi‑Fi обычно стабильнее сотовой" : nil) : "Нет интернета"))
        if m.lowData {
            await add(0.14, BoostLine(title: "Экономия трафика", value: "включена", state: .warn,
                                      hint: "Выключи в настройках Wi‑Fi/сотовой — режет сеть игре"))
        }
        let regions: [(String, String)] = [
            ("Корея", "ec2.ap-northeast-2.amazonaws.com"),
            ("Япония", "ec2.ap-northeast-1.amazonaws.com"),
            ("Москва", "ya.ru"),
            ("Европа", "ec2.eu-central-1.amazonaws.com"),
            ("Ближ. Восток", "ec2.me-south-1.amazonaws.com"),
        ]
        var idx: [Int] = []
        for (k, r) in regions.enumerated() {
            idx.append(await add(0.18 + 0.05 * Double(k), BoostLine(title: r.0, value: "…", state: .work)))
        }
        var results: [(String, PingResult)] = []
        await withTaskGroup(of: (Int, PingResult?).self) { g in
            for (k, r) in regions.enumerated() {
                g.addTask { (k, await PingTester.measure(host: r.1)) }
            }
            for await (k, res) in g {
                if let res {
                    results.append((regions[k].0, res))
                    let ms = Int(res.avg)
                    self.replace(idx[k], BoostLine(title: regions[k].0, value: "\(ms) мс · ±\(Int(res.jitter))",
                                                   state: ms > 150 || res.jitter > 25 ? .warn : .ok))
                } else {
                    self.replace(idx[k], BoostLine(title: regions[k].0, value: "нет ответа", state: .warn))
                }
            }
        }
        if Task.isCancelled { return }
        bump(0.8)
        if let best = results.min(by: { $0.1.avg < $1.1.avg }) {
            bestPing = (best.0, Int(best.1.avg))
            let shaky = best.1.jitter > 20
            await add(0.9, BoostLine(title: "Лучший сервер", value: best.0, state: .ok,
                                     hint: shaky ? "Пинг скачет: подойди к роутеру, выключи VPN, загрузки и iCloud-фото"
                                                 : "Выбери этот регион в лобби PUBG"))
        }
    }

    private func freezeSteps(_ m: SystemMonitor, from p0: Double, to p1: Double) async {
        let hot = m.thermal != .nominal
        await add(0.15, BoostLine(title: "Нагрев", value: m.thermalText, state: hot ? .warn : .ok,
                                  hint: hot ? "Сними чехол, не играй на зарядке — горячий iPhone сбрасывает частоту" : nil))
        await add(0.3, BoostLine(title: "Энергосбережение", value: m.lowPower ? "включено" : "выключено",
                                 state: m.lowPower ? .warn : .ok,
                                 hint: m.lowPower ? "Выключи — оно режет FPS\(m.hasProMotion ? " и экран до 60 Гц" : "")" : nil))
        await add(0.45, BoostLine(title: "Экран", value: "\(m.screenHz) Гц", state: .ok,
                                  hint: m.hasProMotion ? "Универсальный доступ → Движение → выключи «Ограничение частоты кадров»" : nil))
        let lowSpace = m.totalGB > 0 && m.freeGB < 4
        await add(0.6, BoostLine(title: "Память диска", value: String(format: "%.0f ГБ своб.", m.freeGB),
                                 state: lowSpace ? .warn : .ok,
                                 hint: lowSpace ? "Меньше 4 ГБ — игра подгружает текстуры рывками" : nil))
        let profile: Profile = hot || m.model.tier <= .mid ? .performance : .balanced
        let s = Recommender.settings(profile, tier: m.model.tier, hz: m.screenHz)
        let gfx = s.rows.first { $0.name == "Графика" }?.value ?? ""
        var fps = s.rows.first { $0.name == "Частота кадров" }?.value ?? ""
        if hot && fps.contains("120") { fps = "90 FPS" }
        freezeHint = "\(gfx) · \(fps)"
        await add(0.8, BoostLine(title: "Графика в PUBG", value: gfx, state: .ok))
        await add(0.9, BoostLine(title: "Частота кадров", value: fps, state: .ok,
                                 hint: "Выше — телефон греется и начинает фризить. Тени и сглаживание — выкл"))
    }

    // MARK: запуск

    func launch() {
        phase = .launching
        haptic.impactOccurred(intensity: 1)
        if heatReminder { HeatReminder.schedule() }
        let e = edition
        GameLauncher.launch(e) { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                if result == .appStore {
                    self.launchNote = "iOS не дал открыть PUBG \(e.name) напрямую — открыл её в App Store, жми «Открыть»."
                }
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                if self.phase == .launching { self.phase = .idle }
            }
        }
    }

    @discardableResult
    private func add(_ p: Double, _ line: BoostLine) async -> Int {
        try? await Task.sleep(nanoseconds: 300_000_000)
        withAnimation(.easeOut(duration: 0.25)) {
            lines.append(line)
            progress = max(progress, p)
        }
        haptic.impactOccurred(intensity: line.state == .warn ? 0.9 : 0.4)
        return lines.count - 1
    }

    private func replace(_ i: Int, _ line: BoostLine) {
        guard lines.indices.contains(i) else { return }
        withAnimation(.easeOut(duration: 0.2)) { lines[i] = line }
    }

    private func bump(_ p: Double) {
        withAnimation(.easeOut(duration: 0.4)) { progress = max(progress, p) }
    }
}
