import Foundation
import Darwin
import os

/// Очистка ОЗУ. iOS не даёт закрывать чужие приложения напрямую, но если ненадолго
/// занять много памяти, система сама выгружает свёрнутые приложения и освобождает ОЗУ.
/// Потом память сразу отдаётся обратно — она достаётся игре.
enum RAMCleaner {
    /// Свободная + неактивная память системы, МБ.
    static func freeMB() -> Double {
        var stats = vm_statistics64_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.stride / MemoryLayout<integer_t>.stride)
        let kr = withUnsafeMutablePointer(to: &stats) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return 0 }
        let pages = UInt64(stats.free_count) + UInt64(stats.inactive_count) + UInt64(stats.purgeable_count)
        return Double(pages) * Double(vm_kernel_page_size) / 1_048_576
    }

    static var totalMB: Double { Double(ProcessInfo.processInfo.physicalMemory) / 1_048_576 }

    struct Result { let beforeMB: Double; let afterMB: Double }

    /// Давит на память, пока до лимита приложения не останется запас, затем всё отпускает.
    static func purge() async -> Result {
        let before = freeMB()
        await Task.detached(priority: .userInitiated) {
            let chunk = 48 * 1_048_576
            let margin = 320 * 1_048_576
            var blocks: [UnsafeMutableRawPointer] = []
            let deadline = Date().addingTimeInterval(4)
            while Date() < deadline, blocks.count < 120 {
                let left = os_proc_available_memory()
                if left > 0 && left < margin + chunk { break }
                if left == 0 && blocks.count * chunk > Int(Double(ProcessInfo.processInfo.physicalMemory) * 0.35) { break }
                guard let p = malloc(chunk) else { break }
                memset(p, 0x5A, chunk)          // реально занимаем страницы
                blocks.append(p)
                usleep(12_000)                   // даём системе выгрузить фоновые приложения
            }
            usleep(150_000)
            blocks.forEach { free($0) }
        }.value
        try? await Task.sleep(nanoseconds: 450_000_000)
        return Result(beforeMB: before, afterMB: freeMB())
    }

    static func gb(_ mb: Double) -> String { String(format: "%.1f ГБ", mb / 1024) }
}
