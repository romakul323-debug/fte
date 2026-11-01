import SwiftUI

@main
struct GFXTunerApp: App {
    @StateObject private var monitor = SystemMonitor()
    @StateObject private var ping = PingTester()
    @StateObject private var launcher = Launcher()

    init() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(red: 0.03, green: 0.0, blue: 0.01, alpha: 1)
        tab.shadowColor = UIColor(Theme.blood.opacity(0.5))
        let item = UITabBarItemAppearance()
        item.normal.iconColor = UIColor(Theme.steel)
        item.normal.titleTextAttributes = [.foregroundColor: UIColor(Theme.steel)]
        item.selected.iconColor = UIColor(Theme.blood)
        item.selected.titleTextAttributes = [.foregroundColor: UIColor(Theme.blood)]
        tab.stackedLayoutAppearance = item
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                HomeView()
                    .tabItem { Label("Логово", systemImage: "flame.fill") }
                ProfilesView()
                    .tabItem { Label("Графика", systemImage: "slider.horizontal.3") }
                PingView()
                    .tabItem { Label("Пинг", systemImage: "bolt.horizontal.fill") }
                TipsView()
                    .tabItem { Label("Советы", systemImage: "book.closed.fill") }
            }
            .environmentObject(monitor)
            .environmentObject(ping)
            .environmentObject(launcher)
            .tint(Theme.blood)
            .preferredColorScheme(.dark)
            .overlay { SummonOverlay() .environmentObject(launcher) }
            .sheet(isPresented: $launcher.showShortcutHelp) {
                ShortcutHelp().environmentObject(launcher)
            }
            .onAppear { launcher.startAutoIfNeeded() }
        }
    }
}

// MARK: - Цвета и шрифты

enum Theme {
    static let bg = Color(red: 0.012, green: 0.0, blue: 0.004)
    static let blood = Color(red: 0.86, green: 0.07, blue: 0.13)
    static let darkBlood = Color(red: 0.38, green: 0.02, blue: 0.05)
    static let ember = Color(red: 1.0, green: 0.32, blue: 0.12)
    static let bone = Color(red: 0.93, green: 0.89, blue: 0.85)
    static let steel = Color(red: 0.58, green: 0.56, blue: 0.56)
    static let dim = Color(red: 0.80, green: 0.66, blue: 0.66).opacity(0.75)

    // для совместимости со старыми экранами
    static let accent = blood
    static let card2 = Color(red: 0.16, green: 0.03, blue: 0.05)

    static let hellGradient = LinearGradient(colors: [Color(red: 1, green: 0.18, blue: 0.16), blood, darkBlood],
                                             startPoint: .top, endPoint: .bottom)

    static func gothic(_ size: CGFloat) -> Font { .custom("PirataOne-Regular", size: size) }
    static func heading(_ size: CGFloat) -> Font { .system(size: size, weight: .black, design: .serif) }
}

// MARK: - Фон: тьма, багровое зарево, летящие угли

struct HellBackground: View {
    var body: some View {
        ZStack {
            Theme.bg
            RadialGradient(colors: [Theme.darkBlood.opacity(0.85), .clear], center: .top, startRadius: 0, endRadius: 520)
            RadialGradient(colors: [Theme.blood.opacity(0.22), .clear], center: .bottom, startRadius: 0, endRadius: 420)
            EmberField()
        }
        .ignoresSafeArea()
    }
}

struct EmberField: View {
    private struct Ember {
        let x: Double, speed: Double, size: Double, phase: Double, sway: Double
    }
    private let embers: [Ember] = (0..<46).map { _ in
        Ember(x: .random(in: 0...1), speed: .random(in: 0.025...0.08), size: .random(in: 1.2...3.6),
              phase: .random(in: 0...1), sway: .random(in: 6...22))
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSinceReferenceDate
                for e in embers {
                    let p = (e.phase + t * e.speed).truncatingRemainder(dividingBy: 1)
                    let y = size.height * (1.05 - p * 1.1)
                    let x = size.width * e.x + sin(t * 1.1 + e.phase * 12) * e.sway
                    let a = sin(p * .pi)
                    let r = e.size
                    let glow = CGRect(x: x - r * 3, y: y - r * 3, width: r * 6, height: r * 6)
                    ctx.fill(Path(ellipseIn: glow), with: .color(Theme.blood.opacity(0.18 * a)))
                    let core = CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)
                    ctx.fill(Path(ellipseIn: core), with: .color(Theme.ember.opacity(0.9 * a)))
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Карточки, кнопки, экран

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(HellPanel(radius: 20))
    }
}

/// Тёмная панель с кровавой кромкой и свечением.
struct HellPanel: View {
    var radius: CGFloat = 18
    var lit = false
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(LinearGradient(colors: [Color(red: 0.10, green: 0.012, blue: 0.022).opacity(0.92),
                                          Color(red: 0.04, green: 0.0, blue: 0.008).opacity(0.92)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(shape.strokeBorder(LinearGradient(colors: [Theme.blood.opacity(lit ? 1 : 0.75),
                                                                Theme.steel.opacity(0.18),
                                                                Theme.blood.opacity(lit ? 0.6 : 0.25)],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                                        lineWidth: lit ? 1.6 : 1))
            .shadow(color: Theme.blood.opacity(lit ? 0.55 : 0.22), radius: lit ? 16 : 10)
    }
}

struct HellButton: View {
    let title: String
    var icon = "flame.fill"
    var big = true
    let action: () -> Void
    @State private var pulse = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                Text(title).tracking(1.5)
            }
            .font(big ? .system(size: 19, weight: .black, design: .serif) : .system(size: 16, weight: .heavy, design: .serif))
            .foregroundStyle(Theme.bone)
            .frame(maxWidth: .infinity)
            .padding(.vertical, big ? 18 : 13)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Theme.hellGradient)
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Color(red: 1, green: 0.45, blue: 0.4).opacity(0.7), lineWidth: 1))
            )
            .shadow(color: Theme.blood.opacity(pulse ? 0.9 : 0.4), radius: pulse ? 22 : 10)
        }
        .buttonStyle(.plain)
        .onAppear {
            guard big else { return }
            withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { pulse = true }
        }
    }
}

struct Screen<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        ZStack {
            HellBackground()
            ScrollView {
                VStack(spacing: 14) {
                    if !title.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(Theme.heading(32))
                            .foregroundStyle(Theme.bone)
                            .shadow(color: Theme.blood, radius: 10)
                        if let subtitle {
                            Text(subtitle).font(.subheadline).foregroundStyle(Theme.dim)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 8)
                    }
                    content
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
        }
    }
}
