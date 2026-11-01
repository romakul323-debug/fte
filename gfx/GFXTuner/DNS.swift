import Foundation
import Network
import UIKit

/// Профиль «Lensy DNS»: зашифрованный DNS Cloudflare 1.1.1.1 (DNS-over-HTTPS).
enum LensyDNS {
    static let profile = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>PayloadContent</key>
        <array>
            <dict>
                <key>DNSSettings</key>
                <dict>
                    <key>DNSProtocol</key>
                    <string>HTTPS</string>
                    <key>ServerURL</key>
                    <string>https://cloudflare-dns.com/dns-query</string>
                    <key>ServerAddresses</key>
                    <array>
                        <string>1.1.1.1</string>
                        <string>1.0.0.1</string>
                        <string>2606:4700:4700::1111</string>
                        <string>2606:4700:4700::1001</string>
                    </array>
                </dict>
                <key>PayloadDescription</key>
                <string>Быстрый зашифрованный DNS 1.1.1.1 для Lensy</string>
                <key>PayloadDisplayName</key>
                <string>Lensy · تحسين الرؤية</string>
                <key>PayloadIdentifier</key>
                <string>ru.gfxtuner.app.dns.settings</string>
                <key>PayloadType</key>
                <string>com.apple.dnsSettings.managed</string>
                <key>PayloadUUID</key>
                <string>6C1F4B0E-6E3B-4A5D-9C2E-3F1A7B9D2E41</string>
                <key>PayloadVersion</key>
                <integer>1</integer>
            </dict>
        </array>
        <key>PayloadDescription</key>
        <string>Lensy DNS — зашифрованный DNS 1.1.1.1. Удаляется в Настройках в любой момент.</string>
        <key>PayloadDisplayName</key>
        <string>Lensy · تحسين الرؤية</string>
        <key>PayloadIdentifier</key>
        <string>ru.gfxtuner.app.dns</string>
        <key>PayloadRemovalDisallowed</key>
        <false/>
        <key>PayloadType</key>
        <string>Configuration</string>
        <key>PayloadUUID</key>
        <string>A2D8E5C3-91B7-4F06-8E4A-5B2C7D1E9F30</string>
        <key>PayloadVersion</key>
        <integer>1</integer>
    </dict>
    </plist>
    """

    /// Файл профиля во временной папке (для «Поделиться» → «Сохранить в Файлы»).
    static func fileURL() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Lensy.mobileconfig")
        try? profile.data(using: .utf8)?.write(to: url)
        return url
    }
}

/// Крошечный сервер на самом телефоне: отдаёт профиль Safari с правильным типом,
/// чтобы iOS предложила его установить.
final class ProfileServer {
    static let shared = ProfileServer()
    private var listener: NWListener?
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    func install() {
        stop()
        guard let listener = try? NWListener(using: .tcp, on: .any) else { return }
        self.listener = listener
        listener.newConnectionHandler = { [weak self] conn in self?.serve(conn) }
        listener.stateUpdateHandler = { [weak self] state in
            guard case .ready = state, let port = listener.port?.rawValue else { return }
            DispatchQueue.main.async {
                self?.keepAlive()
                if let url = URL(string: "http://127.0.0.1:\(port)/Lensy.mobileconfig") {
                    UIApplication.shared.open(url)
                }
            }
        }
        listener.start(queue: DispatchQueue(label: "lensy.profile"))
    }

    private func serve(_ conn: NWConnection) {
        conn.start(queue: DispatchQueue(label: "lensy.profile.conn"))
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in
            let body = LensyDNS.profile.data(using: .utf8) ?? Data()
            var head = "HTTP/1.1 200 OK\r\n"
            head += "Content-Type: application/x-apple-aspen-config\r\n"
            head += "Content-Disposition: attachment; filename=\"Lensy.mobileconfig\"\r\n"
            head += "Content-Length: \(body.count)\r\nConnection: close\r\n\r\n"
            conn.send(content: (head.data(using: .utf8) ?? Data()) + body, completion: .contentProcessed { _ in
                conn.cancel()
            })
        }
    }

    /// Даём серверу ~30 секунд пожить в фоне, пока Safari забирает профиль.
    private func keepAlive() {
        bgTask = UIApplication.shared.beginBackgroundTask { [weak self] in self?.stop() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.stop() }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        if bgTask != .invalid {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
    }
}
