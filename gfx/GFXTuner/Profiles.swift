import SwiftUI

enum Profile: String, CaseIterable, Identifiable {
    case performance, balanced, quality, ultra
    var id: String { rawValue }

    var title: String {
        switch self {
        case .performance: return "Скорость"
        case .balanced: return "Баланс"
        case .quality: return "Качество"
        case .ultra: return "Ультра"
        }
    }

    var icon: String {
        switch self {
        case .performance: return "bolt.fill"
        case .balanced: return "scale.3d"
        case .quality: return "sparkles"
        case .ultra: return "crown.fill"
        }
    }

    var subtitle: String {
        switch self {
        case .performance: return "Максимум кадров и минимальная задержка. Для игры на результат."
        case .balanced: return "Плавно и прилично выглядит, телефон греется умеренно."
        case .quality: return "Красивая картинка, кадров меньше. Для неспешной игры."
        case .ultra: return "Максимальная графика. Сильно греет и садит батарею."
        }
    }

    static func recommended(for tier: Tier) -> Profile {
        tier <= .mid ? .performance : .balanced
    }
}

struct SettingRow: Identifiable {
    let id = UUID()
    let name: String
    let value: String
}

struct GameSettings {
    let rows: [SettingRow]
    let warning: String?
}

enum Recommender {
    private static func pick(_ t: Tier, _ low: String, _ mid: String, _ high: String, _ top: String, _ flagship: String) -> String {
        switch t {
        case .low: return low
        case .mid: return mid
        case .high: return high
        case .top: return top
        case .flagship: return flagship
        }
    }

    static func maxFPS(tier: Tier, hz: Int) -> String {
        if hz >= 100 {
            if tier >= .top { return "120 FPS" }
            if tier >= .high { return "90 FPS" }
        }
        return "Extreme 60"
    }

    static func settings(_ p: Profile, tier: Tier, hz: Int) -> GameSettings {
        let fpsMax = maxFPS(tier: tier, hz: hz)
        let graphics: String
        let fps: String
        var aa = "Off"
        var shadows = "Off"
        var style = "Colorful"
        var warning: String? = nil

        switch p {
        case .performance:
            graphics = "Smooth"
            fps = fpsMax

        case .balanced:
            graphics = pick(tier, "Smooth", "Balanced", "Balanced", "HD", "HD")
            switch tier {
            case .low, .mid: fps = "Extreme 60"
            case .high: fps = hz >= 100 ? "90 FPS" : "Extreme 60"
            case .top, .flagship: fps = hz >= 100 ? "90 FPS" : "Extreme 60"
            }
            shadows = tier >= .top ? "On" : "Off"

        case .quality:
            graphics = pick(tier, "Balanced", "HD", "HDR", "HDR", "UHD")
            fps = pick(tier, "High 30", "Ultra 40", "Extreme 60", "Extreme 60", "Extreme 60")
            aa = tier >= .high ? "On" : "Off"
            shadows = "On"
            style = "Realistic"
            if tier == .low { warning = "Для твоего iPhone это тяжело: будет проседать и греться." }

        case .ultra:
            graphics = pick(tier, "HD", "HDR", "UHD", "UHD", "UHD")
            fps = pick(tier, "Medium 25", "High 30", "Ultra 40", "Extreme 60", "Extreme 60")
            aa = "On"
            shadows = "On"
            style = "Realistic"
            if tier <= .mid { warning = "Для твоего iPhone это слишком: будут лаги и сильный нагрев." }
            else if tier == .high { warning = "Телефон быстро нагреется, через 10–15 минут возможны просадки." }
        }

        return GameSettings(rows: [
            SettingRow(name: "Графика", value: graphics),
            SettingRow(name: "Частота кадров", value: fps),
            SettingRow(name: "Стиль", value: style),
            SettingRow(name: "Сглаживание", value: aa),
            SettingRow(name: "Тени", value: shadows),
            SettingRow(name: "Авто-настройка графики", value: "Off"),
        ], warning: warning)
    }
}
