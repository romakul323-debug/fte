import SwiftUI
import UIKit
import Network

/// Живое состояние телефона: нагрев, батарея, память, сеть.
final class SystemMonitor: ObservableObject {
    @Published var thermal: ProcessInfo.ThermalState = ProcessInfo.processInfo.thermalState
    @Published var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    @Published var battery: Float = -1
    @Published var batteryState: UIDevice.BatteryState = .unknown
    @Published var freeGB: Double = 0
    @Published var totalGB: Double = 0
    @Published var netType = "—"
    @Published var online = true
    @Published var lowData = false

    let ramGB: Int
    let screenHz: Int
    let model: DeviceModel
    let iosVersion = UIDevice.current.systemVersion

    private let pathMonitor = NWPathMonitor()
    private var observers: [NSObjectProtocol] = []

    init() {
        let ram = Int((Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824).rounded())
        ramGB = ram
        screenHz = UIScreen.main.maximumFramesPerSecond
        model = DeviceCatalog.current(ramGB: ram)
        UIDevice.current.isBatteryMonitoringEnabled = true
        refresh()

        let names: [Notification.Name] = [
            ProcessInfo.thermalStateDidChangeNotification,
            .NSProcessInfoPowerStateDidChange,
            UIDevice.batteryLevelDidChangeNotification,
            UIDevice.batteryStateDidChangeNotification,
            UIApplication.didBecomeActiveNotification,
        ]
        for n in names {
            observers.append(NotificationCenter.default.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in
                self?.refresh()
            })
        }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async { self?.apply(path) }
        }
        pathMonitor.start(queue: DispatchQueue(label: "gfx.net"))
    }

    deinit {
        pathMonitor.cancel()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    func refresh() {
        thermal = ProcessInfo.processInfo.thermalState
        lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        battery = UIDevice.current.batteryLevel
        batteryState = UIDevice.current.batteryState
        let url = URL(fileURLWithPath: NSHomeDirectory())
        if let v = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]) {
            freeGB = Double(v.volumeAvailableCapacityForImportantUsage ?? 0) / 1_000_000_000
            totalGB = Double(v.volumeTotalCapacity ?? 0) / 1_000_000_000
        }
    }

    private func apply(_ path: NWPath) {
        online = path.status == .satisfied
        lowData = path.isConstrained
        if !online { netType = "Нет сети" }
        else if path.usesInterfaceType(.wifi) { netType = "Wi‑Fi" }
        else if path.usesInterfaceType(.cellular) { netType = "Сотовая" }
        else if path.usesInterfaceType(.wiredEthernet) { netType = "Кабель" }
        else { netType = "Другая" }
    }

    // MARK: - Подписи для экрана

    var thermalText: String {
        switch thermal {
        case .nominal: return "Холодный"
        case .fair: return "Тёплый"
        case .serious: return "Горячий"
        case .critical: return "Перегрев"
        @unknown default: return "—"
        }
    }

    var thermalColor: Color {
        switch thermal {
        case .nominal: return .green
        case .fair: return .yellow
        case .serious: return .orange
        default: return .red
        }
    }

    var batteryText: String {
        guard battery >= 0 else { return "—" }
        let p = Int((battery * 100).rounded())
        switch batteryState {
        case .charging: return "\(p)% ⚡︎"
        case .full: return "100% ⚡︎"
        default: return "\(p)%"
        }
    }

    var isCharging: Bool { batteryState == .charging || batteryState == .full }
    var hasProMotion: Bool { screenHz >= 100 }

    var storageText: String {
        guard totalGB > 0 else { return "—" }
        return String(format: "%.0f из %.0f ГБ", freeGB, totalGB)
    }
}
