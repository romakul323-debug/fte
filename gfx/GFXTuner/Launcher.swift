import SwiftUI
import UIKit

/// Запуск PUBG: напрямую по ссылке игры, а если не вышло — через команду в «Командах».
@MainActor
final class Launcher: ObservableObject {
    static let appStore = URL(string: "https://apps.apple.com/app/id1330123889")!
    static let schemes = ["pubgmobile://", "pubgm://"]
    static let shortcutName = "PUBG"

    @Published var countdown: Int? = nil
    @Published var showShortcutHelp = false
    @Published var autoLaunch: Bool {
        didSet { UserDefaults.standard.set(autoLaunch, forKey: "autoLaunch") }
    }
    @Published var useShortcut: Bool {
        didSet { UserDefaults.standard.set(useShortcut, forKey: "useShortcut") }
    }

    private var didAuto = false
    private var task: Task<Void, Never>?

    init() {
        let d = UserDefaults.standard
        autoLaunch = d.object(forKey: "autoLaunch") as? Bool ?? true
        useShortcut = d.bool(forKey: "useShortcut")
    }

    /// Автозапуск — один раз при открытии приложения.
    func startAutoIfNeeded() {
        guard autoLaunch, !didAuto else { return }
        didAuto = true
        startCountdown()
    }

    func startCountdown(from n: Int = 3) {
        task?.cancel()
        countdown = n
        task = Task { [weak self] in
            for _ in 0..<n {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self, !Task.isCancelled, let c = self.countdown else { return }
                self.countdown = c - 1
            }
            guard let self, !Task.isCancelled else { return }
            self.countdown = nil
            self.launch()
        }
    }

    func cancel() {
        task?.cancel()
        countdown = nil
    }

    func launch() {
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        if useShortcut { runShortcut() } else { tryScheme(0) }
    }

    private func tryScheme(_ i: Int) {
        guard i < Self.schemes.count, let url = URL(string: Self.schemes[i]) else {
            showShortcutHelp = true
            return
        }
        UIApplication.shared.open(url, options: [:]) { [weak self] ok in
            guard !ok else { return }
            Task { @MainActor in self?.tryScheme(i + 1) }
        }
    }

    func runShortcut() {
        let name = Self.shortcutName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? Self.shortcutName
        if let url = URL(string: "shortcuts://run-shortcut?name=\(name)") {
            UIApplication.shared.open(url)
        }
    }

    func openShortcutsApp() {
        if let url = URL(string: "shortcuts://create-shortcut") { UIApplication.shared.open(url) }
    }

    func openAppStore() { UIApplication.shared.open(Self.appStore) }
}

// MARK: - Обратный отсчёт перед запуском

struct SummonOverlay: View {
    @EnvironmentObject var launcher: Launcher
    @State private var pulse = false

    var body: some View {
        if let n = launcher.countdown {
            ZStack {
                Color.black.opacity(0.88).ignoresSafeArea()
                RadialGradient(colors: [Theme.blood.opacity(0.55), .clear], center: .center, startRadius: 0, endRadius: 320)
                    .ignoresSafeArea()
                EmberField().ignoresSafeArea()
                VStack(spacing: 22) {
                    Image("Demon")
                        .resizable().scaledToFit()
                        .frame(width: 210, height: 210)
                        .shadow(color: Theme.blood, radius: pulse ? 40 : 14)
                        .scaleEffect(pulse ? 1.05 : 0.97)
                    Text("ПРИЗЫВ PUBG MOBILE")
                        .font(Theme.heading(20)).tracking(3)
                        .foregroundStyle(Theme.bone)
                    Text(n > 0 ? "\(n)" : "🔥")
                        .font(.system(size: 110, weight: .black, design: .serif))
                        .foregroundStyle(Theme.hellGradient)
                        .shadow(color: Theme.blood, radius: 24)
                        .contentTransition(.numericText())
                        .animation(.spring(), value: n)
                    Button("Отмена") { launcher.cancel() }
                        .font(.headline)
                        .foregroundStyle(Theme.steel)
                        .padding(.horizontal, 30).padding(.vertical, 12)
                        .background(Capsule().strokeBorder(Theme.steel.opacity(0.5)))
                }
            }
            .transition(.opacity)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
        }
    }
}

// MARK: - Настройка запуска через «Команды»

struct ShortcutHelp: View {
    @EnvironmentObject var launcher: Launcher
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            HellBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Открыть PUBG напрямую не вышло")
                        .font(Theme.heading(24)).foregroundStyle(Theme.bone)
                        .shadow(color: Theme.blood, radius: 8)
                    Text("PUBG не всегда принимает прямой запуск из других приложений. Надёжный способ — через «Команды». Настраивается один раз, минута дела.")
                        .foregroundStyle(Theme.dim)
                    Card {
                        step(1, "Нажми «Открыть Команды» ниже — откроется новая пустая команда.")
                        step(2, "«Добавить действие» → найди «Открыть приложение» → выбери PUBG MOBILE.")
                        step(3, "Сверху переименуй команду ровно в «\(Launcher.shortcutName)» и нажми «Готово».")
                        step(4, "Вернись сюда и нажми «Готово, запускай».")
                    }
                    HellButton(title: "Открыть Команды", icon: "square.stack.3d.up.fill", big: false) {
                        launcher.openShortcutsApp()
                    }
                    HellButton(title: "Готово, запускай", icon: "flame.fill") {
                        launcher.useShortcut = true
                        dismiss()
                        launcher.launch()
                    }
                    Button("PUBG не установлен — открыть App Store") { launcher.openAppStore() }
                        .font(.subheadline).foregroundStyle(Theme.steel)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                }
                .padding(20)
            }
        }
        .preferredColorScheme(.dark)
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(.caption.bold()).frame(width: 24, height: 24)
                .foregroundStyle(Theme.bone).background(Theme.blood, in: Circle())
            Text(text).font(.subheadline).foregroundStyle(Theme.bone)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
