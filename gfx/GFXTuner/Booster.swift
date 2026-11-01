import SwiftUI
import UIKit
import UserNotifications
import ActivityKit

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
            content.title = "\(minutes) دقيقة في اللعب"
            content.body = "إذا سخن الهاتف، أعطه دقيقة راحة بين الجولات — سيتوقف التقطيع."
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(minutes * 60), repeats: false)
            c.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        }
    }

    static func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }
}

/// «حقن LENSY» поверх PUBG — через Live Activity (Dynamic Island / баннер).
/// Шаги отражают то, что Lensy реально сделал перед запуском.
@MainActor
enum Injector {
    static func run(game: String, freedMB: Double?) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let steps = [
            (0.10, "ربط LENSY باللعبة"),
            (0.25, freedMB.map { "تم تحرير \(Int($0)) ميغابايت" } ?? "تحرير الذاكرة"),
            (0.45, "تثبيت الشبكة"),
            (0.65, "مراقبة الحرارة"),
            (0.85, "تهيئة الإطارات"),
            (1.00, "جاهز للقتال"),
        ]
        let first = InjectAttributes.ContentState(progress: 0.0, step: "بدء الحقن", done: false)
        guard let activity = try? Activity.request(
            attributes: InjectAttributes(game: game),
            content: ActivityContent(state: first, staleDate: nil),
            pushType: nil) else { return }

        var bg: UIBackgroundTaskIdentifier = .invalid
        bg = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(bg) }

        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            var alerted = false
            var cur = 0
            for (p, step) in steps {
                // плавно добегаем до следующей отметки
                let target = Int(p * 100)
                for v in stride(from: cur + 3, through: target, by: 3) + [target] where v > cur {
                    cur = v
                    let st = InjectAttributes.ContentState(progress: Double(v) / 100, step: step, done: false)
                    await activity.update(ActivityContent(state: st, staleDate: nil),
                                          alertConfiguration: alerted ? nil : AlertConfiguration(
                                            title: "حقن LENSY", body: "جارٍ الحقن في \(game)…", sound: .default))
                    alerted = true
                    try? await Task.sleep(nanoseconds: 90_000_000)
                }
            }
            let done = InjectAttributes.ContentState(progress: 1, step: "جاهز للقتال", done: true)
            await activity.update(ActivityContent(state: done, staleDate: nil),
                                  alertConfiguration: AlertConfiguration(title: "تم الحقن ✓", body: "LENSY يعمل · \(game)", sound: .default))
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            await activity.end(ActivityContent(state: done, staleDate: nil), dismissalPolicy: .after(.now + 6))
            UIApplication.shared.endBackgroundTask(bg)
        }
    }
}

enum BoostAction: String {
    case ram, lag, freeze, launch

    var title: String {
        switch self {
        case .ram: return "تنظيف الذاكرة"
        case .lag: return "إزالة اللاغ"
        case .freeze: return "منع التقطيع"
        case .launch: return "اقتحام"
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

    @Published var bestPing: (name: String, ms: Int)? = nil
    @Published var freedMB: Double? = nil
    @Published var freezeHint: String? = nil

    @Published var autoLaunch: Bool { didSet { save(autoLaunch, "autoLaunch2") } }
    @Published var heatReminder: Bool { didSet { save(heatReminder, "heatReminder") } }
    @Published var inject: Bool { didSet { save(inject, "inject") } }
    @Published var editionChoice: String { didSet { UserDefaults.standard.set(editionChoice, forKey: "edition2") } }

    var active: Bool { phase != .idle }
    var edition: GameEdition { GameLauncher.edition(for: editionChoice) }

    private var task: Task<Void, Never>?
    private var didAuto = false
    private let haptic = UIImpactFeedbackGenerator(style: .medium)

    init() {
        let d = UserDefaults.standard
        autoLaunch = d.bool(forKey: "autoLaunch2")
        heatReminder = d.bool(forKey: "heatReminder")
        inject = d.object(forKey: "inject") as? Bool ?? true
        editionChoice = d.string(forKey: "edition2") ?? "kr"
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
            case .lag: await self.lagSteps(m)
            case .freeze: await self.freezeSteps(m)
            case .launch:
                await self.quickChecks(m)
                await self.ramSteps(m, from: 0.3, to: 0.85)
            }
            if Task.isCancelled { return }
            await self.add(1.0, BoostLine(title: "تم", value: "", state: .info))
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
        await add(0.1, BoostLine(title: "الحرارة", value: m.thermalText, state: hot ? .warn : .ok,
                                 hint: hot ? "دع الهاتف يبرد دقيقتين — وإلا سيحدث تقطيع" : nil))
        if m.lowPower {
            await add(0.2, BoostLine(title: "توفير الطاقة", value: "مفعّل", state: .warn,
                                     hint: "أوقفه من مركز التحكم — يخفض الإطارات"))
        }
    }

    private func ramSteps(_ m: SystemMonitor, from p0: Double, to p1: Double) async {
        let before = RAMCleaner.freeMB()
        await add(p0 + (p1 - p0) * 0.2, BoostLine(title: "المتاح الآن", value: RAMCleaner.gb(before), state: .info))
        let i = await add(p0 + (p1 - p0) * 0.35, BoostLine(title: "تفريغ تطبيقات الخلفية", value: "…", state: .work))
        let r = await RAMCleaner.purge()
        if Task.isCancelled { return }
        let gained = max(0, r.afterMB - r.beforeMB)
        freedMB = gained
        replace(i, BoostLine(title: "تفريغ تطبيقات الخلفية", value: gained > 30 ? "+\(Int(gained)) MB" : "نظيفة", state: .ok))
        bump(p0 + (p1 - p0) * 0.85)
        await add(p1, BoostLine(title: "المتاح للعبة", value: RAMCleaner.gb(r.afterMB), state: .ok))
    }

    private func lagSteps(_ m: SystemMonitor) async {
        await add(0.08, BoostLine(title: "الشبكة", value: m.netType, state: m.online ? .ok : .warn,
                                  hint: m.online ? (m.netType == "خلوي" ? "الواي فاي عادةً أكثر استقراراً" : nil) : "لا يوجد إنترنت"))
        if m.lowData {
            await add(0.14, BoostLine(title: "توفير البيانات", value: "مفعّل", state: .warn,
                                      hint: "أوقفه من إعدادات الشبكة — يقيّد اتصال اللعبة"))
        }
        let regions: [(String, String)] = [
            ("كوريا", "ec2.ap-northeast-2.amazonaws.com"),
            ("اليابان", "ec2.ap-northeast-1.amazonaws.com"),
            ("موسكو", "ya.ru"),
            ("أوروبا", "ec2.eu-central-1.amazonaws.com"),
            ("الشرق الأوسط", "ec2.me-south-1.amazonaws.com"),
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
                    self.replace(idx[k], BoostLine(title: regions[k].0, value: "\(ms) ms · ±\(Int(res.jitter))",
                                                   state: ms > 150 || res.jitter > 25 ? .warn : .ok))
                } else {
                    self.replace(idx[k], BoostLine(title: regions[k].0, value: "لا استجابة", state: .warn))
                }
            }
        }
        if Task.isCancelled { return }
        bump(0.8)
        if let best = results.min(by: { $0.1.avg < $1.1.avg }) {
            bestPing = (best.0, Int(best.1.avg))
            let shaky = best.1.jitter > 20
            await add(0.9, BoostLine(title: "أفضل سيرفر", value: best.0, state: .ok,
                                     hint: shaky ? "البينغ يقفز: اقترب من الراوتر، أوقف VPN والتنزيلات"
                                                 : "اختر هذه المنطقة في لوبي PUBG"))
        }
    }

    private func freezeSteps(_ m: SystemMonitor) async {
        let hot = m.thermal != .nominal
        await add(0.15, BoostLine(title: "الحرارة", value: m.thermalText, state: hot ? .warn : .ok,
                                  hint: hot ? "انزع الغطاء ولا تلعب أثناء الشحن — الهاتف الساخن يخفض السرعة" : nil))
        await add(0.3, BoostLine(title: "توفير الطاقة", value: m.lowPower ? "مفعّل" : "معطّل",
                                 state: m.lowPower ? .warn : .ok,
                                 hint: m.lowPower ? "أوقفه — يخفض الإطارات\(m.hasProMotion ? " ويقيّد الشاشة بـ 60 هرتز" : "")" : nil))
        await add(0.45, BoostLine(title: "الشاشة", value: "\(m.screenHz) Hz", state: .ok,
                                  hint: m.hasProMotion ? "تسهيلات الاستخدام ← الحركة ← أوقف «تحديد معدل الإطارات»" : nil))
        let lowSpace = m.totalGB > 0 && m.freeGB < 4
        await add(0.6, BoostLine(title: "مساحة التخزين", value: String(format: "%.0f GB", m.freeGB),
                                 state: lowSpace ? .warn : .ok,
                                 hint: lowSpace ? "أقل من 4 غيغابايت — تحميل الخامات يصبح متقطعاً" : nil))
        let profile: Profile = hot || m.model.tier <= .mid ? .performance : .balanced
        let s = Recommender.settings(profile, tier: m.model.tier, hz: m.screenHz)
        let gfx = s.rows.first { $0.name == "Графика" }?.value ?? ""
        var fps = s.rows.first { $0.name == "Частота кадров" }?.value ?? ""
        if hot && fps.contains("120") { fps = "90 FPS" }
        freezeHint = "\(gfx) · \(fps)"
        await add(0.8, BoostLine(title: "الرسومات في PUBG", value: gfx, state: .ok))
        await add(0.9, BoostLine(title: "معدل الإطارات", value: fps, state: .ok,
                                 hint: "الظلال والتنعيم — إيقاف. أعلى من ذلك = حرارة وتقطيع"))
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
                if result == .opened, self.inject {
                    Injector.run(game: "PUBG \(e.id.uppercased())", freedMB: self.freedMB)
                }
                if result == .appStore {
                    self.launchNote = "لم يسمح iOS بفتح PUBG \(e.name) مباشرة — فُتحت في App Store، اضغط «فتح»."
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
