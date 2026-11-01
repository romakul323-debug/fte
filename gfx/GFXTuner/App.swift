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

// MARK: - Палитра: чернота, пепел, немного запёкшейся крови

enum Theme {
    static let bg = Color.black
    static let ink = Color(white: 0.88)
    static let ash = Color(white: 0.48)
    static let faint = Color(white: 0.16)
    static let blood = Color(red: 0.55, green: 0.02, blue: 0.04)
    static let bloodLight = Color(red: 0.80, green: 0.08, blue: 0.10)

    static func serif(_ size: CGFloat, _ weight: Font.Weight = .light) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

/// Едва заметная рамка.
struct Frame: View {
    var radius: CGFloat = 14
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Color(white: 0.04).opacity(0.85))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(Theme.faint, lineWidth: 1))
    }
}
