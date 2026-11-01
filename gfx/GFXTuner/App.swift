import SwiftUI

@main
struct GFXTunerApp: App {
    @StateObject private var monitor = SystemMonitor()
    @StateObject private var ping = PingTester()

    init() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(Theme.card)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                HomeView()
                    .tabItem { Label("Главная", systemImage: "gauge.with.dots.needle.67percent") }
                ProfilesView()
                    .tabItem { Label("Графика", systemImage: "slider.horizontal.3") }
                PingView()
                    .tabItem { Label("Пинг", systemImage: "wifi") }
                TipsView()
                    .tabItem { Label("Советы", systemImage: "lightbulb.fill") }
            }
            .environmentObject(monitor)
            .environmentObject(ping)
            .tint(Theme.accent)
            .preferredColorScheme(.dark)
        }
    }
}

enum Theme {
    static let bg = Color(red: 0.043, green: 0.051, blue: 0.071)
    static let card = Color(red: 0.086, green: 0.098, blue: 0.133)
    static let card2 = Color(red: 0.12, green: 0.135, blue: 0.18)
    static let accent = Color(red: 1.0, green: 0.69, blue: 0.125)
    static let dim = Color.white.opacity(0.55)
}

/// Тёмная карточка с закруглением.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

struct Screen<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) { content }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(title)
            .toolbarBackground(Theme.bg, for: .navigationBar)
        }
    }
}

/// Запуск PUBG: пробуем схемы игры, иначе открываем её страницу в App Store.
enum GameLauncher {
    static let appStore = URL(string: "https://apps.apple.com/app/id1330123889")!
    static let schemes = ["pubgmobile://", "pubgm://"]

    static func launch() {
        tryNext(0)
    }

    private static func tryNext(_ i: Int) {
        guard i < schemes.count, let url = URL(string: schemes[i]) else {
            UIApplication.shared.open(appStore)
            return
        }
        UIApplication.shared.open(url, options: [:]) { ok in
            if !ok { tryNext(i + 1) }
        }
    }
}
