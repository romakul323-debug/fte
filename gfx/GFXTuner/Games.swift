import SwiftUI
import UIKit
import ObjectiveC

/// Версии PUBG MOBILE.
struct GameEdition: Identifiable, Equatable {
    let id: String
    let name: String
    let appStoreID: String?
    let store: String          // страна App Store для поиска
    let guesses: [String]      // известные ID приложения в системе
    var schemes: [String] = ["igame1320://", "fb1036341366506456://"]   // ссылки запуска игры (из Info.plist PUBG)

    static let global = GameEdition(id: "global", name: "Global", appStoreID: "1330123889", store: "us",
                                    guesses: ["com.tencent.ig"])
    static let kr = GameEdition(id: "kr", name: "Корея (KR)", appStoreID: "1366526331", store: "kr",
                                guesses: ["com.pubg.krmobile", "com.pubg.korea", "com.pubg.kr"])
    static let others = GameEdition(id: "other", name: "Другие регионы", appStoreID: nil, store: "us",
                                    guesses: ["com.pubg.imobile", "com.vng.pubgmobile", "com.rekoo.pubgm"])
    static let all: [GameEdition] = [.global, .kr]

    var appStoreURL: URL? {
        guard let appStoreID else { return nil }
        return URL(string: "https://apps.apple.com/\(store)/app/id\(appStoreID)")
    }

    /// Точный ID из App Store (узнаём один раз и запоминаем) + известные варианты.
    var bundleIDs: [String] {
        var ids: [String] = []
        if let cached = UserDefaults.standard.string(forKey: "bundle.\(id)") { ids.append(cached) }
        for g in guesses where !ids.contains(g) { ids.append(g) }
        return ids
    }
}

enum GameLauncher {
    /// Узнаёт настоящие ID игр через App Store, чтобы находить их на телефоне.
    static func resolveBundleIDs() async {
        for e in GameEdition.all {
            guard let appID = e.appStoreID,
                  UserDefaults.standard.string(forKey: "bundle.\(e.id)") == nil,
                  let url = URL(string: "https://itunes.apple.com/lookup?id=\(appID)&country=\(e.store)") else { continue }
            guard let response = try? await URLSession.shared.data(from: url),
                  let json = try? JSONSerialization.jsonObject(with: response.0) as? [String: Any],
                  let results = json["results"] as? [[String: Any]],
                  let bundle = results.first?["bundleId"] as? String else { continue }
            UserDefaults.standard.set(bundle, forKey: "bundle.\(e.id)")
        }
    }

    // MARK: системный «рабочий стол» iOS

    private static var workspace: NSObject? {
        guard let cls = NSClassFromString("LSApplicationWorkspace") else { return nil }
        let sel = NSSelectorFromString("defaultWorkspace")
        guard let method = class_getClassMethod(cls, sel) else { return nil }
        typealias Fn = @convention(c) (AnyClass, Selector) -> Unmanaged<AnyObject>?
        let fn = unsafeBitCast(method_getImplementation(method), to: Fn.self)
        return fn(cls, sel)?.takeUnretainedValue() as? NSObject
    }

    private static func call(_ ws: NSObject, _ name: String, _ id: String) -> Bool? {
        let sel = NSSelectorFromString(name)
        guard ws.responds(to: sel) else { return nil }
        typealias Fn = @convention(c) (AnyObject, Selector, NSString) -> Bool
        let fn = unsafeBitCast(ws.method(for: sel), to: Fn.self)
        return fn(ws, sel, id as NSString)
    }

    /// nil — iOS не даёт проверить; true/false — установлена или нет.
    /// Работает ли ссылка запуска игры (самый надёжный признак на новых iOS).
    static var schemeWorks: Bool {
        guard let url = URL(string: "igame1320://") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    static func isInstalled(_ e: GameEdition) -> Bool? {
        if e == .global && schemeWorks { return true }
        guard let ws = workspace else { return nil }
        var known = false
        for id in e.bundleIDs {
            guard let r = call(ws, "applicationIsInstalled:", id) else { return nil }
            known = true
            if r { return true }
        }
        return known ? false : nil
    }

    /// Какую версию запускать: выбранную, иначе первую найденную на телефоне.
    static func edition(for choice: String) -> GameEdition {
        if let e = GameEdition.all.first(where: { $0.id == choice }) { return e }
        if isInstalled(.kr) == true && isInstalled(.global) != true { return .kr }
        return .global
    }

    enum Result { case opened, appStore }

    static func launch(_ e: GameEdition, _ done: @escaping (Result) -> Void) {
        tryScheme(e, 0, done)
    }

    /// 1) ссылки игры  2) запуск по ID (на старых iOS)  3) App Store.
    private static func tryScheme(_ e: GameEdition, _ i: Int, _ done: @escaping (Result) -> Void) {
        guard i < e.schemes.count, let url = URL(string: e.schemes[i]) else {
            if openByID(e) { done(.opened); return }
            if let url = e.appStoreURL { UIApplication.shared.open(url) }
            done(.appStore)
            return
        }
        UIApplication.shared.open(url, options: [:]) { ok in
            if ok { done(.opened) } else { tryScheme(e, i + 1, done) }
        }
    }

    private static func openByID(_ e: GameEdition) -> Bool {
        guard let ws = workspace else { return false }
        var ids = e.bundleIDs
        if e == .global { ids += GameEdition.others.bundleIDs }
        for id in ids where call(ws, "openApplicationWithBundleID:", id) == true { return true }
        return false
    }
}
