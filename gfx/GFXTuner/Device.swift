import UIKit
import Darwin

/// Класс мощности устройства — от него зависят рекомендации.
enum Tier: Int, Comparable {
    case low = 0, mid, high, top, flagship

    static func < (a: Tier, b: Tier) -> Bool { a.rawValue < b.rawValue }

    var title: String {
        switch self {
        case .low: return "Слабый"
        case .mid: return "Средний"
        case .high: return "Хороший"
        case .top: return "Мощный"
        case .flagship: return "Топовый"
        }
    }

    var stars: Int { rawValue + 1 }
}

struct DeviceModel {
    let name: String
    let chip: String
    let tier: Tier
}

enum DeviceCatalog {
    static var identifier: String {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? "Simulator"
        #else
        var info = utsname()
        uname(&info)
        let mirror = Mirror(reflecting: info.machine)
        return mirror.children.reduce(into: "") { s, el in
            if let v = el.value as? Int8, v != 0 { s.append(Character(UnicodeScalar(UInt8(v)))) }
        }
        #endif
    }

    private static func m(_ n: String, _ c: String, _ t: Tier) -> DeviceModel { DeviceModel(name: n, chip: c, tier: t) }

    static let table: [String: DeviceModel] = [
        "iPhone9,1": m("iPhone 7", "A10 Fusion", .low), "iPhone9,3": m("iPhone 7", "A10 Fusion", .low),
        "iPhone9,2": m("iPhone 7 Plus", "A10 Fusion", .low), "iPhone9,4": m("iPhone 7 Plus", "A10 Fusion", .low),
        "iPhone10,1": m("iPhone 8", "A11 Bionic", .low), "iPhone10,4": m("iPhone 8", "A11 Bionic", .low),
        "iPhone10,2": m("iPhone 8 Plus", "A11 Bionic", .low), "iPhone10,5": m("iPhone 8 Plus", "A11 Bionic", .low),
        "iPhone10,3": m("iPhone X", "A11 Bionic", .low), "iPhone10,6": m("iPhone X", "A11 Bionic", .low),
        "iPhone11,2": m("iPhone XS", "A12 Bionic", .mid), "iPhone11,4": m("iPhone XS Max", "A12 Bionic", .mid),
        "iPhone11,6": m("iPhone XS Max", "A12 Bionic", .mid), "iPhone11,8": m("iPhone XR", "A12 Bionic", .mid),
        "iPhone12,1": m("iPhone 11", "A13 Bionic", .mid), "iPhone12,3": m("iPhone 11 Pro", "A13 Bionic", .mid),
        "iPhone12,5": m("iPhone 11 Pro Max", "A13 Bionic", .mid), "iPhone12,8": m("iPhone SE (2-го пок.)", "A13 Bionic", .mid),
        "iPhone13,1": m("iPhone 12 mini", "A14 Bionic", .high), "iPhone13,2": m("iPhone 12", "A14 Bionic", .high),
        "iPhone13,3": m("iPhone 12 Pro", "A14 Bionic", .high), "iPhone13,4": m("iPhone 12 Pro Max", "A14 Bionic", .high),
        "iPhone14,4": m("iPhone 13 mini", "A15 Bionic", .high), "iPhone14,5": m("iPhone 13", "A15 Bionic", .high),
        "iPhone14,2": m("iPhone 13 Pro", "A15 Bionic", .high), "iPhone14,3": m("iPhone 13 Pro Max", "A15 Bionic", .high),
        "iPhone14,6": m("iPhone SE (3-го пок.)", "A15 Bionic", .high),
        "iPhone14,7": m("iPhone 14", "A15 Bionic", .high), "iPhone14,8": m("iPhone 14 Plus", "A15 Bionic", .high),
        "iPhone15,2": m("iPhone 14 Pro", "A16 Bionic", .top), "iPhone15,3": m("iPhone 14 Pro Max", "A16 Bionic", .top),
        "iPhone15,4": m("iPhone 15", "A16 Bionic", .top), "iPhone15,5": m("iPhone 15 Plus", "A16 Bionic", .top),
        "iPhone16,1": m("iPhone 15 Pro", "A17 Pro", .top), "iPhone16,2": m("iPhone 15 Pro Max", "A17 Pro", .top),
        "iPhone17,3": m("iPhone 16", "A18", .top), "iPhone17,4": m("iPhone 16 Plus", "A18", .top),
        "iPhone17,5": m("iPhone 16e", "A18", .top),
        "iPhone17,1": m("iPhone 16 Pro", "A18 Pro", .flagship), "iPhone17,2": m("iPhone 16 Pro Max", "A18 Pro", .flagship),
        "iPhone18,3": m("iPhone 17", "A19", .flagship), "iPhone18,4": m("iPhone Air", "A19 Pro", .flagship),
        "iPhone18,1": m("iPhone 17 Pro", "A19 Pro", .flagship), "iPhone18,2": m("iPhone 17 Pro Max", "A19 Pro", .flagship),
    ]

    static func current(ramGB: Int) -> DeviceModel {
        let id = identifier
        if let known = table[id] { return known }
        // Неизвестная (новая) модель — оцениваем по памяти
        let tier: Tier
        switch ramGB {
        case 8...: tier = .flagship
        case 6..<8: tier = .top
        case 4..<6: tier = .high
        case 3..<4: tier = .mid
        default: tier = .low
        }
        return DeviceModel(name: "\(UIDevice.current.model) (\(id))", chip: "—", tier: tier)
    }
}
