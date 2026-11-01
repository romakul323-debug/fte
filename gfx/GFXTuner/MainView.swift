import SwiftUI

enum SheetKind: String, Identifiable {
    case dns, settings
    var id: String { rawValue }
}

struct MainView: View {
    @EnvironmentObject var m: SystemMonitor
    @EnvironmentObject var booster: Booster
    @State private var sheet: SheetKind?
    @State private var appeared = false

    var body: some View {
        ZStack {
            Darkness()

            VStack(spacing: 0) {
                Spacer(minLength: 40)

                GlitchText(text: "LENSY", font: Theme.serif(40, .ultraLight), tracking: 16)
                    .opacity(appeared ? 1 : 0)
                Text("تحسين الرؤية")
                    .font(Theme.serif(13))
                    .foregroundStyle(Theme.blood)
                    .padding(.top, 6)
                    .opacity(appeared ? 1 : 0)

                Spacer()

                LaunchButton { booster.start(monitor: m) }
                    .frame(width: 250, height: 250)
                    .opacity(appeared ? 1 : 0)
                    .scaleEffect(appeared ? 1 : 0.94)

                Spacer()

                status
                    .padding(.bottom, 22)

                Whisper().padding(.bottom, 22)

                HStack(spacing: 0) {
                    TextButton(title: "DNS") { sheet = .dns }
                    Rectangle().fill(Theme.faint).frame(width: 1, height: 16)
                    TextButton(title: "НАСТРОЙКИ") { sheet = .settings }
                }
                .padding(.bottom, 26)
            }
            .padding(.horizontal, 20)

            if booster.active {
                LaunchOverlay().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.5), value: booster.active)
        .sheet(item: $sheet) { kind in
            Group {
                switch kind {
                case .dns: DNSSheet()
                case .settings: SettingsSheet()
                }
            }
            .environmentObject(m)
            .environmentObject(booster)
        }
        .onAppear {
            m.refresh()
            withAnimation(.easeOut(duration: 1.6)) { appeared = true }
        }
    }

    private var status: some View {
        TimelineView(.periodic(from: .now, by: 3)) { _ in
            HStack(spacing: 14) {
                stat("НАГРЕВ", m.thermal == .nominal ? "норм" : m.thermalText.lowercased(), hot: m.thermal != .nominal)
                stat("ОЗУ", RAMCleaner.gb(RAMCleaner.freeMB()), hot: false)
                stat("ПИНГ", booster.bestPing.map { "\($0.ms) мс" } ?? "—", hot: (booster.bestPing?.ms ?? 0) > 120)
            }
        }
    }

    private func stat(_ label: String, _ value: String, hot: Bool) -> some View {
        VStack(spacing: 4) {
            Text(label).font(Theme.mono(9, .medium)).tracking(2).foregroundStyle(Theme.ash.opacity(0.7))
            Text(value).font(Theme.mono(14, .medium)).foregroundStyle(hot ? Theme.bloodLight : Theme.ink)
        }
        .frame(maxWidth: .infinity)
    }
}

struct TextButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.mono(12, .medium)).tracking(4)
                .foregroundStyle(Theme.ash)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }
}

/// Большая чёрная кнопка LAUNCH: тонкие кольца, медленное дыхание.
struct LaunchButton: View {
    let action: () -> Void
    @State private var pressed = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let b = breath(t, period: 4.5)
            ZStack {
                Circle()
                    .stroke(Theme.faint, style: StrokeStyle(lineWidth: 1, dash: [1, 7]))
                    .rotationEffect(.degrees(t * 4))
                Circle()
                    .trim(from: 0, to: 0.18)
                    .stroke(Theme.blood.opacity(0.35 + 0.4 * b), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
                    .rotationEffect(.degrees(-t * 11))
                    .padding(14)
                Button(action: action) {
                    ZStack {
                        Circle().fill(Color.black)
                        Circle().strokeBorder(Color(white: 0.22 + 0.18 * b), lineWidth: 1)
                        VStack(spacing: 8) {
                            Text("LAUNCH")
                                .font(Theme.serif(30, .ultraLight))
                                .tracking(9)
                                .foregroundStyle(Theme.ink)
                                .padding(.leading, 9)
                            Rectangle().fill(Theme.blood.opacity(0.6 + 0.4 * b)).frame(width: 26, height: 1)
                            Text("озу · сеть · запуск")
                                .font(Theme.mono(9)).tracking(2)
                                .foregroundStyle(Theme.ash)
                        }
                    }
                    .frame(width: 186, height: 186)
                    .shadow(color: .white.opacity(0.03 + 0.05 * b), radius: 30)
                    .shadow(color: Theme.blood.opacity(pressed ? 0.8 : 0.12 * b), radius: pressed ? 40 : 24)
                    .scaleEffect(pressed ? 0.96 : 1)
                }
                .buttonStyle(.plain)
                .simultaneousGesture(DragGesture(minimumDistance: 0)
                    .onChanged { _ in if !pressed { pressed = true; UIImpactFeedbackGenerator(style: .soft).impactOccurred() } }
                    .onEnded { _ in pressed = false })
            }
        }
    }
}

// MARK: - Экран запуска

struct LaunchOverlay: View {
    @EnvironmentObject var booster: Booster

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Darkness(fog: 0.6)

            VStack(spacing: 18) {
                Spacer(minLength: 50)
                ZStack {
                    Circle().stroke(Theme.faint, lineWidth: 1)
                    Circle()
                        .trim(from: 0, to: booster.progress)
                        .stroke(LinearGradient(colors: [Theme.ink, Theme.bloodLight], startPoint: .top, endPoint: .bottom),
                                style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 6) {
                        Text("\(Int(booster.progress * 100))")
                            .font(Theme.serif(44, .ultraLight).monospacedDigit())
                            .foregroundStyle(Theme.ink)
                        Text(title).font(Theme.mono(9, .medium)).tracking(3).foregroundStyle(Theme.ash)
                    }
                }
                .frame(width: 170, height: 170)

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(booster.lines) { line in
                        LineRow(line: line).transition(.opacity)
                    }
                }
                .padding(.horizontal, 26)
                .padding(.top, 8)

                if let note = booster.launchNote {
                    Text(note).font(Theme.serif(13)).foregroundStyle(Theme.ash)
                        .multilineTextAlignment(.center).padding(.horizontal, 30)
                }

                Spacer()

                HStack(spacing: 0) {
                    TextButton(title: booster.phase == .done ? "ЗАКРЫТЬ" : "ОТМЕНА") { booster.cancel() }
                    if booster.phase == .done && !booster.autoLaunch {
                        Rectangle().fill(Theme.faint).frame(width: 1, height: 16)
                        Button { booster.launch() } label: {
                            Text("ЗАПУСТИТЬ")
                                .font(Theme.mono(12, .bold)).tracking(4)
                                .foregroundStyle(Theme.bloodLight)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 26)
            }
        }
    }

    private var title: String {
        switch booster.phase {
        case .running: return "ПОДГОТОВКА"
        case .done: return "ГОТОВО"
        case .launching: return "ЗАПУСК PUBG"
        case .idle: return ""
        }
    }
}

struct LineRow: View {
    let line: BoostLine
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 10) {
                Group {
                    switch line.state {
                    case .work: Text("…").foregroundStyle(Theme.ash)
                    case .ok: Text("—").foregroundStyle(Theme.ash)
                    case .warn: Text("!").foregroundStyle(Theme.bloodLight)
                    }
                }
                .font(Theme.mono(13, .bold))
                .frame(width: 14, alignment: .leading)
                Text(line.title.uppercased()).font(Theme.mono(11, .medium)).tracking(1.5).foregroundStyle(Theme.ash)
                Spacer()
                Text(line.value).font(Theme.mono(13, .medium))
                    .foregroundStyle(line.state == .warn ? Theme.bloodLight : Theme.ink)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            if let h = line.hint {
                Text(h).font(Theme.serif(12).italic()).foregroundStyle(Theme.ash.opacity(0.8)).padding(.leading, 24)
            }
        }
        .padding(.vertical, 7)
    }
}

// MARK: - Шторки

struct SheetScaffold<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack {
            Darkness(fog: 0.5)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text(title).font(Theme.serif(30, .ultraLight)).tracking(6).foregroundStyle(Theme.ink)
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.system(size: 14, weight: .light)).foregroundStyle(Theme.ash)
                                .padding(10)
                        }
                    }
                    .padding(.top, 40)
                    content
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 30)
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct DNSSheet: View {
    @State private var shareURL: URL?

    var body: some View {
        SheetScaffold(title: "DNS") {
            Text("Lensy · تحسين الرؤية")
                .font(Theme.serif(16)).foregroundStyle(Theme.bloodLight)
            Text("Зашифрованный DNS 1.1.1.1 (Cloudflare). Адреса серверов игры находятся быстрее и стабильнее, провайдер не подменяет ответы и не видит, куда ты заходишь.")
                .font(Theme.serif(15)).foregroundStyle(Theme.ink.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Text("На пинг в самом бою DNS не влияет: он работает только в момент поиска сервера. Хедшоты и регистрация попаданий от DNS не зависят.")
                .font(Theme.serif(13).italic()).foregroundStyle(Theme.ash)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 12) {
                step(1, "Нажми «Установить» — откроется Safari, разреши загрузку профиля.")
                step(2, "Настройки → Основные → VPN и управление устройством → Lensy → Установить.")
                step(3, "Там же: DNS → выбери Lensy.")
                step(4, "Если стоит другой DNS-профиль (например, sevanDNS) — удали его, два сразу не работают.")
            }
            .padding(16)
            .background(Frame())

            Button { ProfileServer.shared.install() } label: {
                Text("УСТАНОВИТЬ")
                    .font(Theme.mono(13, .bold)).tracking(5)
                    .foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.blood, lineWidth: 1))
            }
            .buttonStyle(.plain)

            Button { shareURL = LensyDNS.fileURL() } label: {
                Text("сохранить файл профиля")
                    .font(Theme.mono(11)).tracking(2).foregroundStyle(Theme.ash)
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
            }
            .buttonStyle(.plain)
        }
        .sheet(item: $shareURL) { url in ShareSheet(items: [url]) }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)").font(Theme.mono(12, .bold)).foregroundStyle(Theme.bloodLight).frame(width: 14)
            Text(text).font(Theme.serif(14)).foregroundStyle(Theme.ink.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

extension URL: Identifiable { public var id: String { absoluteString } }

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

struct SettingsSheet: View {
    @EnvironmentObject var booster: Booster

    var body: some View {
        SheetScaffold(title: "НАСТРОЙКИ") {
            VStack(alignment: .leading, spacing: 4) {
                Text("ВЕРСИЯ PUBG").font(Theme.mono(10, .medium)).tracking(3).foregroundStyle(Theme.ash)
                    .padding(.bottom, 6)
                editionRow(id: "auto", name: "Авто", detail: GameLauncher.schemeWorks ? "игра найдена" : "")
                ForEach(GameEdition.all) { e in
                    editionRow(id: e.id, name: e.name, detail: "")
                }
            }
            .padding(16)
            .background(Frame())

            VStack(spacing: 14) {
                toggle("Автозапуск", "Открыл Lensy — подготовка и сразу PUBG", $booster.autoLaunch)
                Rectangle().fill(Theme.faint).frame(height: 1)
                toggle("Напоминание о перегреве", "Через 30, 60 и 90 минут игры", Binding(
                    get: { booster.heatReminder },
                    set: { on in
                        if on {
                            HeatReminder.request { ok in booster.heatReminder = ok }
                        } else {
                            booster.heatReminder = false
                            HeatReminder.cancel()
                        }
                    }))
            }
            .padding(16)
            .background(Frame())

            Text("Очистка ОЗУ: Lensy на пару секунд занимает память, и iOS сама выгружает свёрнутые приложения. Освободившаяся память достаётся игре — меньше подгрузок и фризов в начале катки.")
                .font(Theme.serif(13).italic()).foregroundStyle(Theme.ash)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func editionRow(id: String, name: String, detail: String) -> some View {
        Button { booster.editionChoice = id } label: {
            HStack {
                Circle()
                    .fill(booster.editionChoice == id ? Theme.bloodLight : .clear)
                    .overlay(Circle().strokeBorder(Theme.ash, lineWidth: 1))
                    .frame(width: 12, height: 12)
                Text(name).font(Theme.serif(17)).foregroundStyle(Theme.ink)
                Spacer()
                Text(detail).font(Theme.mono(10)).foregroundStyle(Theme.ash)
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    private func toggle(_ title: String, _ sub: String, _ binding: Binding<Bool>) -> some View {
        Toggle(isOn: binding) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Theme.serif(17)).foregroundStyle(Theme.ink)
                Text(sub).font(Theme.serif(12).italic()).foregroundStyle(Theme.ash)
            }
        }
        .tint(Theme.blood)
    }
}
