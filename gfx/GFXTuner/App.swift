import SwiftUI

@main
struct GFXTunerApp: App {
    @StateObject private var monitor = SystemMonitor()
    @StateObject private var booster = Booster()

    var body: some Scene {
        WindowGroup {
            MainView()
                .environmentObject(monitor)
                .environmentObject(booster)
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
                .onAppear { booster.autoStartIfNeeded(monitor: monitor) }
        }
    }
}

// MARK: - Цвета и шрифты

enum Theme {
    static let bg = Color(red: 0.008, green: 0.0, blue: 0.003)
    static let blood = Color(red: 0.86, green: 0.05, blue: 0.10)
    static let darkBlood = Color(red: 0.36, green: 0.01, blue: 0.04)
    static let clot = Color(red: 0.20, green: 0.0, blue: 0.02)
    static let ember = Color(red: 1.0, green: 0.30, blue: 0.10)
    static let bone = Color(red: 0.93, green: 0.88, blue: 0.84)
    static let steel = Color(red: 0.55, green: 0.52, blue: 0.52)
    static let dim = Color(red: 0.78, green: 0.62, blue: 0.62).opacity(0.75)

    static let hellGradient = LinearGradient(colors: [Color(red: 1, green: 0.16, blue: 0.14), blood, darkBlood],
                                             startPoint: .top, endPoint: .bottom)

    static func gothic(_ size: CGFloat) -> Font { .custom("PirataOne-Regular", size: size) }
    static func heading(_ size: CGFloat) -> Font { .system(size: size, weight: .black, design: .serif) }
}

/// Тёмная панель с кровавой кромкой.
struct HellPanel: View {
    var radius: CGFloat = 18
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(LinearGradient(colors: [Color(red: 0.09, green: 0.008, blue: 0.018).opacity(0.92),
                                          Color(red: 0.03, green: 0.0, blue: 0.006).opacity(0.92)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(shape.strokeBorder(LinearGradient(colors: [Theme.blood.opacity(0.75), Theme.steel.opacity(0.12), Theme.blood.opacity(0.3)],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
            .shadow(color: Theme.blood.opacity(0.25), radius: 10)
    }
}
