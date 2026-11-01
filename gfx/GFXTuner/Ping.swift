import SwiftUI
import Network

struct PingTarget: Identifiable {
    let id: String
    let flag: String
    let name: String
    let host: String
}

struct PingResult {
    var avg: Double
    var jitter: Double
    var loss: Int   // из PingTester.samples
}

/// Одноразовый флаг: продолжение должно завершиться ровно один раз.
private final class Once: @unchecked Sendable {
    var done = false
}

@MainActor
final class PingTester: ObservableObject {
    static let samples = 5

    let targets: [PingTarget] = [
        PingTarget(id: "msk", flag: "🇷🇺", name: "Москва", host: "ya.ru"),
        PingTarget(id: "fra", flag: "🇩🇪", name: "Европа · Франкфурт", host: "ec2.eu-central-1.amazonaws.com"),
        PingTarget(id: "sto", flag: "🇸🇪", name: "Европа · Стокгольм", host: "ec2.eu-north-1.amazonaws.com"),
        PingTarget(id: "bah", flag: "🇧🇭", name: "Ближний Восток", host: "ec2.me-south-1.amazonaws.com"),
        PingTarget(id: "sin", flag: "🇸🇬", name: "Азия · Сингапур", host: "ec2.ap-southeast-1.amazonaws.com"),
        PingTarget(id: "usa", flag: "🇺🇸", name: "Сев. Америка", host: "ec2.us-east-1.amazonaws.com"),
    ]

    @Published var results: [String: PingResult] = [:]
    @Published var failed: Set<String> = []
    @Published var inProgress: Set<String> = []
    @Published var running = false

    var best: PingTarget? {
        targets.filter { results[$0.id] != nil }.min { results[$0.id]!.avg < results[$1.id]!.avg }
    }

    func runAll() async {
        guard !running else { return }
        running = true
        results = [:]
        failed = []
        inProgress = Set(targets.map(\.id))
        await withTaskGroup(of: Void.self) { group in
            for t in targets {
                group.addTask { [weak self] in
                    let r = await PingTester.measure(host: t.host)
                    await self?.store(t.id, r)
                }
            }
        }
        running = false
    }

    private func store(_ id: String, _ r: PingResult?) {
        inProgress.remove(id)
        if let r { results[id] = r } else { failed.insert(id) }
    }

    nonisolated static func measure(host: String) async -> PingResult? {
        _ = await connectTime(host: host)   // прогрев: DNS и маршрут
        var times: [Double] = []
        for _ in 0..<samples {
            if let t = await connectTime(host: host) { times.append(t) }
        }
        guard !times.isEmpty else { return nil }
        let avg = times.reduce(0, +) / Double(times.count)
        var jitter = 0.0
        if times.count > 1 {
            jitter = zip(times, times.dropFirst()).map { abs($0 - $1) }.reduce(0, +) / Double(times.count - 1)
        }
        return PingResult(avg: avg, jitter: jitter, loss: samples - times.count)
    }

    /// Время установки TCP-соединения ≈ один круг до сервера (RTT), в мс.
    nonisolated static func connectTime(host: String, port: UInt16 = 443, timeout: Double = 2.5) async -> Double? {
        await withCheckedContinuation { (cont: CheckedContinuation<Double?, Never>) in
            let queue = DispatchQueue(label: "gfx.ping.\(host)")
            let conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
            let once = Once()
            let start = DispatchTime.now().uptimeNanoseconds
            let finish: (Double?) -> Void = { value in
                if once.done { return }
                once.done = true
                conn.cancel()
                cont.resume(returning: value)
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
                case .failed, .waiting, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            queue.asyncAfter(deadline: .now() + timeout) { finish(nil) }
            conn.start(queue: queue)
        }
    }
}

extension PingResult {
    var color: Color {
        switch avg {
        case ..<60: return .green
        case ..<120: return .yellow
        default: return .red
        }
    }
}
