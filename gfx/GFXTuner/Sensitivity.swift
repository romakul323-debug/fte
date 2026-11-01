import SwiftUI
import UIKit

/// Стартовая чувствительность PUBG под размер экрана и стиль игры.
enum SensStyle: String, CaseIterable, Identifiable {
    case thumbs, gyro
    var id: String { rawValue }
    var title: String { self == .thumbs ? "Без гироскопа" : "С гироскопом" }
}

struct SensSection: Identifiable {
    let id = UUID()
    let title: String
    let rows: [SettingRow]
}

enum SensCalc {
    private static let scopes = ["Без прицела (3-е лицо)", "Без прицела (1-е лицо)", "Коллиматор / голо", "2x", "3x", "4x", "6x", "8x"]

    /// Больше экран — нужен чуть больший поворот за тот же свайп.
    static var screenFactor: Double {
        let w = Double(UIScreen.main.bounds.width)
        return min(max(w / 393.0, 0.9), 1.12)
    }

    private static func rows(_ base: [Double], scale: Double, maxValue: Double) -> [SettingRow] {
        zip(scopes, base).map { name, v in
            SettingRow(name: name, value: "\(Int(min(maxValue, (v * scale).rounded())))%")
        }
    }

    static func sections(_ style: SensStyle) -> [SensSection] {
        let k = screenFactor
        let camera = [112.0, 100, 55, 34, 24, 18, 13, 10]
        let ads = [106.0, 100, 54, 36, 27, 21, 15, 11]
        var out = [
            SensSection(title: "Камера", rows: rows(camera, scale: k, maxValue: 300)),
            SensSection(title: "Прицеливание (ADS)", rows: rows(ads, scale: k, maxValue: 300)),
        ]
        if style == .gyro {
            let gyro = [300.0, 300, 300, 290, 240, 200, 140, 115]
            out.append(SensSection(title: "Гироскоп", rows: rows(gyro, scale: 1, maxValue: 400)))
            out.append(SensSection(title: "Гироскоп ADS", rows: rows(gyro.map { $0 * 0.95 }, scale: 1, maxValue: 400)))
        }
        return out
    }

    static func text(_ style: SensStyle) -> String {
        sections(style).map { s in
            "\(s.title):\n" + s.rows.map { "  \($0.name): \($0.value)" }.joined(separator: "\n")
        }.joined(separator: "\n\n")
    }
}
