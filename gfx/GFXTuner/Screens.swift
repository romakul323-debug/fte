import SwiftUI

// MARK: - Вход: шуточная кнопка «Убить телефон»

struct RootView: View {
    @EnvironmentObject var m: SystemMonitor
    @EnvironmentObject var booster: Booster
    @State private var entered = false

    var body: some View {
        ZStack {
            if entered {
                MainView()
            } else {
                KillGate {
                    entered = true
                    booster.onEnter(monitor: m)
                }
            }
        }
    }
}

struct KillGate: View {
    let onEnter: () -> Void
    @State private var killing = false
    @State private var shake: CGFloat = 0
    @State private var flash = 0.0
    @State private var cracks = false

    var body: some View {
        ZStack {
            Darkness(fog: 0.7)

            VStack(spacing: 26) {
                Spacer()
                GlitchText(text: "LENSY", font: Theme.serif(34, .ultraLight), tracking: 14)
                Text("предупреждение")
                    .font(Theme.mono(10, .medium)).tracking(4).foregroundStyle(Theme.bloodLight)
                Text("эта кнопка уничтожит\nтвой телефон")
                    .font(Theme.serif(20, .light)).foregroundStyle(Theme.ink.opacity(0.85))
                    .multilineTextAlignment(.center)

                Button(action: kill) {
                    VStack(spacing: 8) {
                        Image(systemName: "bolt.trianglebadge.exclamationmark.fill")
                            .font(.system(size: 30, weight: .thin))
                            .foregroundStyle(Theme.bloodLight)
                        Text("УБИТЬ ТЕЛЕФОН")
                            .font(Theme.mono(15, .bold)).tracking(5)
                            .foregroundStyle(Theme.ink)
                    }
                    .frame(width: 250, height: 120)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(LinearGradient(colors: [Theme.blood.opacity(0.35), .black], startPoint: .top, endPoint: .bottom))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(Theme.bloodLight.opacity(0.7), lineWidth: 1))
                    )
                    .shadow(color: Theme.blood.opacity(0.6), radius: 24)
                }
                .buttonStyle(.plain)
                .disabled(killing)

                Text("не нажимай")
                    .font(Theme.serif(12).italic()).foregroundStyle(Theme.ash.opacity(0.6))
                Spacer()
                Spacer()
            }
            .offset(x: shake)

            if cracks { Cracks().allowsHitTesting(false) }
            Theme.bloodLight.opacity(flash).ignoresSafeArea().allowsHitTesting(false)
            if killing {
                Text("шутка 😈")
                    .font(Theme.serif(28, .light)).foregroundStyle(Theme.ink)
                    .transition(.opacity)
            }
        }
    }

    private func kill() {
        killing = true
        let heavy = UIImpactFeedbackGenerator(style: .heavy)
        heavy.prepare()
        for k in 0..<6 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(k) * 0.06) {
                heavy.impactOccurred(intensity: 1)
                withAnimation(.linear(duration: 0.05)) { shake = k.isMultiple(of: 2) ? 14 : -14 }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.36) {
            withAnimation(.linear(duration: 0.05)) { shake = 0 }
            cracks = true
            flash = 0.55
            withAnimation(.easeOut(duration: 0.5)) { flash = 0 }
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.3) {
            withAnimation(.easeInOut(duration: 0.35)) { onEnter() }
        }
    }
}

/// Трещины на «стекле».
struct Cracks: View {
    var body: some View {
        Canvas { ctx, size in
            var rng = SplitMix(seed: 666)
            let c = CGPoint(x: size.width * 0.52, y: size.height * 0.47)
            for _ in 0..<14 {
                var p = c
                var path = Path()
                path.move(to: p)
                let ang = Double(rng.next() % 6283) / 1000
                for _ in 0..<7 {
                    let a = ang + (Double(rng.next() % 600) / 1000 - 0.3)
                    let len = 30 + Double(rng.next() % 70)
                    p = CGPoint(x: p.x + cos(a) * len, y: p.y + sin(a) * len)
                    path.addLine(to: p)
                }
                ctx.stroke(path, with: .color(.white.opacity(0.75)), lineWidth: 1)
            }
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 6, y: c.y - 6, width: 12, height: 12)), with: .color(.white.opacity(0.6)))
        }
        .ignoresSafeArea()
    }
}

// MARK: - Главный экран

enum SheetKind: String, Identifiable {
    case dns, settings
    var id: String { rawValue }
}

struct MainView: View {
    @EnvironmentObject var m: SystemMonitor
    @EnvironmentObject var booster: Booster
    @State private var sheet: SheetKind?

    var body: some View {
        ZStack {
            Darkness()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 16) {
                    header
                    gauges
                    tiles
                    launchButton
                    Whisper().padding(.top, 4)
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 24)
            }

            if booster.active {
                ActionOverlay().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: booster.active)
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
        .onAppear { m.refresh() }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                GlitchText(text: "LENSY", font: Theme.serif(30, .ultraLight), tracking: 11)
                Text("تحسين الرؤية").font(Theme.serif(12)).foregroundStyle(Theme.bloodLight)
                Text("\(m.model.name) · \(m.screenHz) Гц")
                    .font(Theme.mono(10)).foregroundStyle(Theme.ash)
                    .padding(.top, 2)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 10) {
                Button { sheet = .settings } label: {
                    Image(systemName: "gearshape").font(.system(size: 18, weight: .light)).foregroundStyle(Theme.ash)
                        .padding(8)
                }
                .buttonStyle(.plain)
                Text("PUBG \(booster.edition.id.uppercased())")
                    .font(Theme.mono(10, .bold)).tracking(2)
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Capsule().strokeBorder(Theme.blood, lineWidth: 1))
            }
        }
    }

    private var gauges: some View {
        TimelineView(.periodic(from: .now, by: 3)) { _ in
            let free = RAMCleaner.freeMB()
            HStack(spacing: 10) {
                Gauge(label: "НАГРЕВ", value: m.thermalText.lowercased(),
                      level: [0.2, 0.45, 0.75, 1.0][min(m.thermal.rawValue, 3)], hot: m.thermal.rawValue >= 2)
                Gauge(label: "ОЗУ", value: RAMCleaner.gb(free),
                      level: min(1, free / max(1, RAMCleaner.totalMB)), hot: free < 700)
                Gauge(label: "ПИНГ", value: booster.bestPing.map { "\($0.ms)" } ?? "—",
                      level: booster.bestPing.map { min(1, Double($0.ms) / 200) } ?? 0,
                      hot: (booster.bestPing?.ms ?? 0) > 120)
                Gauge(label: "ЗАРЯД", value: m.battery >= 0 ? "\(Int(m.battery * 100))%" : "—",
                      level: Double(max(0, m.battery)), hot: m.battery >= 0 && m.battery < 0.2 && !m.isCharging)
            }
        }
    }

    private var tiles: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            Tile(icon: "memorychip", title: "ОЧИСТИТЬ ОЗУ",
                 result: booster.freedMB.map { $0 > 30 ? "+\(Int($0)) МБ" : "чисто" } ?? "выгрузить фоновые") {
                booster.run(.ram, monitor: m)
            }
            Tile(icon: "waveform.path.ecg", title: "УБРАТЬ ЛАГИ",
                 result: booster.bestPing.map { "\($0.ms) мс · \($0.name)" } ?? "пинг и сервер") {
                booster.run(.lag, monitor: m)
            }
            Tile(icon: "snowflake", title: "АНТИ-ФРИЗ",
                 result: booster.freezeHint ?? "нагрев и графика") {
                booster.run(.freeze, monitor: m)
            }
            Tile(icon: "shield.lefthalf.filled", title: "LENSY DNS", result: "1.1.1.1 · шифрование") {
                sheet = .dns
            }
        }
    }

    private var launchButton: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let b = breath(tl.date.timeIntervalSinceReferenceDate, period: 3.5)
            Button { booster.run(.launch, monitor: m) } label: {
                HStack(spacing: 14) {
                    Image(systemName: "airplane").font(.system(size: 22, weight: .light))
                        .rotationEffect(.degrees(-30))
                    VStack(alignment: .leading, spacing: 3) {
                        Text("ЗАЛЁТ В PUBG").font(Theme.mono(17, .bold)).tracking(4)
                        Text("очистка ОЗУ и запуск \(booster.edition.name)")
                            .font(Theme.mono(10)).foregroundStyle(Theme.ash)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 16, weight: .light))
                }
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 20).padding(.vertical, 20)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(LinearGradient(colors: [Theme.blood.opacity(0.28 + 0.15 * b), Color(white: 0.03)],
                                             startPoint: .leading, endPoint: .trailing))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Theme.bloodLight.opacity(0.4 + 0.4 * b), lineWidth: 1))
                )
                .shadow(color: Theme.blood.opacity(0.25 + 0.3 * b), radius: 20)
            }
            .buttonStyle(.plain)
        }
    }
}

struct Gauge: View {
    let label: String
    let value: String
    let level: Double
    let hot: Bool
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle().stroke(Theme.faint, lineWidth: 3)
                Circle()
                    .trim(from: 0, to: max(0.02, level))
                    .stroke(hot ? Theme.bloodLight : Theme.ink.opacity(0.8),
                            style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(value).font(Theme.mono(11, .medium)).foregroundStyle(hot ? Theme.bloodLight : Theme.ink)
                    .lineLimit(1).minimumScaleFactor(0.5).padding(.horizontal, 7)
            }
            .frame(width: 64, height: 64)
            Text(label).font(Theme.mono(8, .medium)).tracking(2).foregroundStyle(Theme.ash)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Frame(radius: 16))
    }
}

struct Tile: View {
    let icon: String
    let title: String
    let result: String
    let action: () -> Void
    @State private var pressed = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: icon).font(.system(size: 22, weight: .thin)).foregroundStyle(Theme.bloodLight)
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .light)).foregroundStyle(Theme.ash)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(Theme.mono(13, .bold)).tracking(1.5).foregroundStyle(Theme.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Text(result).font(Theme.mono(10)).foregroundStyle(Theme.ash)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 112, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LinearGradient(colors: [Color(white: 0.07), Color(white: 0.02)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(LinearGradient(colors: [Color(white: 0.22), Theme.faint, Theme.blood.opacity(0.4)],
                                                     startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
            )
            .scaleEffect(pressed ? 0.97 : 1)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(DragGesture(minimumDistance: 0)
            .onChanged { _ in if !pressed { pressed = true; UIImpactFeedbackGenerator(style: .soft).impactOccurred() } }
            .onEnded { _ in pressed = false })
    }
}

// MARK: - Экран действия

struct ActionOverlay: View {
    @EnvironmentObject var booster: Booster
    @EnvironmentObject var m: SystemMonitor

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Darkness(fog: 0.6)

            VStack(spacing: 18) {
                ZStack {
                    Circle().stroke(Theme.faint, lineWidth: 1)
                    Circle()
                        .trim(from: 0, to: booster.progress)
                        .stroke(LinearGradient(colors: [Theme.ink, Theme.bloodLight], startPoint: .top, endPoint: .bottom),
                                style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 6) {
                        Text("\(Int(booster.progress * 100))")
                            .font(Theme.serif(44, .ultraLight).monospacedDigit())
                            .foregroundStyle(Theme.ink)
                        Text(subtitle).font(Theme.mono(9, .medium)).tracking(3).foregroundStyle(Theme.ash)
                    }
                }
                .frame(width: 160, height: 160)
                .padding(.top, 46)

                Text(booster.action.title).font(Theme.mono(14, .bold)).tracking(5).foregroundStyle(Theme.ink)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(booster.lines) { line in
                            LineRow(line: line).transition(.opacity)
                        }
                    }
                    .padding(.horizontal, 24)
                }

                if let note = booster.launchNote {
                    Text(note).font(Theme.serif(13)).foregroundStyle(Theme.ash)
                        .multilineTextAlignment(.center).padding(.horizontal, 30)
                }

                HStack(spacing: 0) {
                    TextButton(title: booster.phase == .done ? "ГОТОВО" : "ОТМЕНА") { booster.cancel() }
                    if booster.phase == .done && booster.action != .launch {
                        Rectangle().fill(Theme.faint).frame(width: 1, height: 16)
                        Button { booster.run(.launch, monitor: m) } label: {
                            Text("ЗАЛЁТ")
                                .font(Theme.mono(12, .bold)).tracking(4)
                                .foregroundStyle(Theme.bloodLight)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
    }

    private var subtitle: String {
        switch booster.phase {
        case .running: return "РАБОТАЮ"
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
                    case .ok: Text("✓").foregroundStyle(Theme.ink.opacity(0.7))
                    case .info: Text("—").foregroundStyle(Theme.ash)
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
                Text(h).font(Theme.serif(12).italic()).foregroundStyle(Theme.ash.opacity(0.85))
                    .padding(.leading, 24)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 7)
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
