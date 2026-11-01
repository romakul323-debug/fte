import SwiftUI

struct MainView: View {
    @EnvironmentObject var m: SystemMonitor
    @EnvironmentObject var booster: Booster
    @State private var showGraphics = false

    var body: some View {
        ZStack {
            HellBackground()

            VStack(spacing: 0) {
                Spacer(minLength: compact ? 14 : 30)
                DemonSkull(size: compact ? 140 : 190)
                    .frame(height: compact ? 150 : 210)

                Text("Lensy")
                    .font(Theme.gothic(58))
                    .foregroundStyle(Theme.bone)
                    .shadow(color: Theme.blood, radius: 14)
                    .padding(.top, -6)
                Text("تحسين الرؤية")
                    .font(.system(size: 15, weight: .heavy, design: .serif))
                    .foregroundStyle(Theme.blood)
                    .shadow(color: Theme.blood, radius: 6)

                Spacer(minLength: compact ? 8 : 20)

                BoostButton { booster.start(monitor: m) }
                    .frame(width: 210, height: 210)
                    .scaleEffect(compact ? 0.85 : 1)

                Spacer(minLength: compact ? 8 : 24)

                statsRow
                    .padding(.horizontal, 16)

                HStack(spacing: 10) {
                    Button { showGraphics = true } label: {
                        Label("Графика PUBG", systemImage: "slider.horizontal.3")
                            .font(.system(size: 14, weight: .heavy, design: .serif))
                            .foregroundStyle(Theme.bone)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(HellPanel(radius: 14))
                    }
                    Button { booster.autoLaunch.toggle() } label: {
                        Label(booster.autoLaunch ? "Автозапуск" : "Автозапуск выкл",
                              systemImage: booster.autoLaunch ? "flame.fill" : "flame")
                            .font(.system(size: 14, weight: .heavy, design: .serif))
                            .foregroundStyle(booster.autoLaunch ? Theme.blood : Theme.steel)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(HellPanel(radius: 14))
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 18)
            }

            if booster.active {
                BoostOverlay()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: booster.active)
        .sheet(isPresented: $showGraphics) { GraphicsSheet().environmentObject(m) }
        .onAppear { m.refresh() }
    }

    private var pingColor: Color {
        guard let p = booster.bestPing else { return Theme.steel }
        if p.ms < 60 { return .green }
        if p.ms < 120 { return .yellow }
        return .red
    }

    private var compact: Bool { UIScreen.main.bounds.height < 740 }

    private var statsRow: some View {
        HStack(spacing: 10) {
            Chip(icon: "thermometer.medium", value: m.thermalText, color: m.thermalColor)
            Chip(icon: "dot.radiowaves.left.and.right",
                 value: booster.bestPing.map { "\($0.ms) мс" } ?? "— мс",
                 color: pingColor)
            Chip(icon: "battery.75percent", value: m.batteryText,
                 color: (m.battery >= 0 && m.battery < 0.2 && !m.isCharging) ? .red : Theme.bone)
            Chip(icon: "display", value: "\(m.screenHz) Гц", color: Theme.bone)
        }
    }
}

struct Chip: View {
    let icon: String
    let value: String
    let color: Color
    var body: some View {
        VStack(spacing: 5) {
            Image(systemName: icon).font(.caption).foregroundStyle(Theme.blood)
            Text(value).font(.system(size: 13, weight: .heavy, design: .serif))
                .foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(HellPanel(radius: 14))
    }
}

/// Огромная кнопка BOOST в рунном круге, бьётся как сердце.
struct BoostButton: View {
    let action: () -> Void
    @State private var pressed = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let beat = heartbeat(tl.date.timeIntervalSinceReferenceDate)
            ZStack {
                RuneRings()
                Button(action: action) {
                    ZStack {
                        Circle()
                            .fill(RadialGradient(colors: [Color(red: 1, green: 0.2, blue: 0.15), Theme.blood, Theme.clot],
                                                 center: .center, startRadius: 5, endRadius: 85))
                        Circle().strokeBorder(Color(red: 1, green: 0.5, blue: 0.45).opacity(0.7), lineWidth: 1.5)
                        VStack(spacing: -4) {
                            Text("BOOST")
                                .font(Theme.gothic(46))
                                .foregroundStyle(Theme.bone)
                                .shadow(color: .black.opacity(0.6), radius: 3, y: 2)
                            Text("и запуск PUBG")
                                .font(.system(size: 11, weight: .heavy, design: .serif))
                                .foregroundStyle(Theme.bone.opacity(0.8))
                        }
                    }
                    .frame(width: 150, height: 150)
                    .shadow(color: Theme.blood.opacity(0.6 + 0.4 * beat), radius: 18 + 26 * beat)
                    .scaleEffect((pressed ? 0.93 : 1) * (1 + 0.035 * beat))
                }
                .buttonStyle(.plain)
                .simultaneousGesture(DragGesture(minimumDistance: 0)
                    .onChanged { _ in pressed = true }
                    .onEnded { _ in pressed = false })
            }
        }
    }
}

// MARK: - Экран буста

struct BoostOverlay: View {
    @EnvironmentObject var booster: Booster

    var body: some View {
        ZStack {
            Color.black.opacity(0.92).ignoresSafeArea()
            HellBackground(intensity: 1.8)
            if booster.phase == .running {
                HeartbeatVignette(intensity: 1.5, period: 0.6).ignoresSafeArea().allowsHitTesting(false)
            }

            VStack(spacing: 14) {
                ZStack {
                    Circle().stroke(Theme.clot, lineWidth: 10)
                    Circle()
                        .trim(from: 0, to: booster.progress)
                        .stroke(AngularGradient(colors: [Theme.darkBlood, Theme.blood, Theme.ember, Theme.blood], center: .center),
                                style: StrokeStyle(lineWidth: 10, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .shadow(color: Theme.blood, radius: 10)
                    DemonSkull(size: 120, shaking: booster.phase == .running)
                }
                .frame(width: 190, height: 190)
                .padding(.top, 40)

                Text(title)
                    .font(Theme.heading(24)).tracking(2)
                    .foregroundStyle(Theme.bone)
                    .shadow(color: Theme.blood, radius: 10)
                Text("\(Int(booster.progress * 100))%")
                    .font(.system(size: 18, weight: .black, design: .serif).monospacedDigit())
                    .foregroundStyle(Theme.blood)

                VStack(spacing: 8) {
                    ForEach(booster.lines) { line in
                        LineRow(line: line)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 16)

                if let note = booster.launchNote {
                    Text(note).font(.footnote).foregroundStyle(Theme.dim)
                        .multilineTextAlignment(.center).padding(.horizontal, 24)
                }

                Spacer()

                HStack(spacing: 12) {
                    Button(booster.phase == .done ? "Закрыть" : "Отмена") { booster.cancel() }
                        .font(.system(size: 15, weight: .heavy, design: .serif))
                        .foregroundStyle(Theme.steel)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Capsule().strokeBorder(Theme.steel.opacity(0.4)))
                    if booster.phase == .done && !booster.autoLaunch {
                        Button { booster.launch() } label: {
                            Text("ЗАПУСТИТЬ PUBG")
                                .font(.system(size: 15, weight: .black, design: .serif))
                                .foregroundStyle(Theme.bone)
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(Capsule().fill(Theme.hellGradient))
                                .shadow(color: Theme.blood, radius: 12)
                        }
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
    }

    private var title: String {
        switch booster.phase {
        case .running: return "ПРОБУЖДЕНИЕ…"
        case .done: return booster.autoLaunch ? "ГОТОВО. ПРИЗЫВАЮ…" : "ГОТОВО"
        case .launching: return "ПРИЗЫВ PUBG"
        case .idle: return ""
        }
    }
}

struct LineRow: View {
    let line: BoostLine
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(color)
                .shadow(color: color, radius: 5)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(line.title).font(.system(size: 14, weight: .bold, design: .serif)).foregroundStyle(Theme.dim)
                    Spacer()
                    Text(line.value).font(.system(size: 14, weight: .heavy, design: .serif)).foregroundStyle(Theme.bone)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                if let h = line.hint {
                    Text(h).font(.caption).foregroundStyle(.orange)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(HellPanel(radius: 12))
    }

    private var icon: String {
        switch line.state {
        case .ok: return "checkmark.seal.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .info: return line.icon
        }
    }

    private var color: Color {
        switch line.state {
        case .ok: return Theme.blood
        case .warn: return .orange
        case .info: return Theme.ember
        }
    }
}

// MARK: - Графика (шторка)

struct GraphicsSheet: View {
    @EnvironmentObject var m: SystemMonitor
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Profile?
    @State private var copied = false

    private var recommended: Profile { Profile.recommended(for: m.model.tier) }
    private var current: Profile { selected ?? recommended }

    var body: some View {
        ZStack {
            HellBackground(intensity: 0.7)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("Графика PUBG").font(Theme.heading(28)).foregroundStyle(Theme.bone)
                            .shadow(color: Theme.blood, radius: 10)
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.headline).foregroundStyle(Theme.steel)
                                .padding(10).background(HellPanel(radius: 20))
                        }
                    }
                    .padding(.top, 50)
                    Text("\(m.model.name) · \(m.model.chip) · \(m.screenHz) Гц").font(.subheadline).foregroundStyle(Theme.dim)

                    HStack(spacing: 8) {
                        ForEach(Profile.allCases) { p in
                            Button { selected = p; copied = false } label: {
                                VStack(spacing: 6) {
                                    Image(systemName: p.icon).font(.title3)
                                    Text(p.title).font(.caption.bold()).lineLimit(1).minimumScaleFactor(0.8)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .foregroundStyle(current == p ? Theme.bone : Theme.steel)
                                .background {
                                    if current == p {
                                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.hellGradient)
                                            .shadow(color: Theme.blood.opacity(0.8), radius: 12)
                                    } else {
                                        HellPanel(radius: 14)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    let s = Recommender.settings(current, tier: m.model.tier, hz: m.screenHz)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(current.title).font(Theme.heading(24)).foregroundStyle(Theme.bone)
                            if current == recommended {
                                Text("ДЛЯ ТЕБЯ").font(.caption2.bold())
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .foregroundStyle(Theme.bone).background(Theme.blood, in: Capsule())
                            }
                        }
                        Text(current.subtitle).font(.subheadline).foregroundStyle(Theme.dim)
                        VStack(spacing: 0) {
                            ForEach(s.rows) { r in
                                HStack {
                                    Text(r.name).foregroundStyle(Theme.dim)
                                    Spacer()
                                    Text(r.value).font(.system(.body, design: .serif).weight(.heavy)).foregroundStyle(Theme.bone)
                                }
                                .padding(.vertical, 10)
                                if r.id != s.rows.last?.id { Divider().overlay(Theme.darkBlood) }
                            }
                        }
                        if let w = s.warning {
                            Label(w, systemImage: "exclamationmark.triangle.fill").font(.subheadline).foregroundStyle(.orange)
                        }
                        Text("PUBG → Настройки → Графика и звук. Если пункта нет — бери ближайший доступный.")
                            .font(.caption).foregroundStyle(Theme.dim)
                    }
                    .padding(16)
                    .background(HellPanel(radius: 20))

                    Button {
                        UIPasteboard.general.string = "PUBG — «\(current.title)» для \(m.model.name):\n" +
                            s.rows.map { "\($0.name): \($0.value)" }.joined(separator: "\n")
                        copied = true
                    } label: {
                        Label(copied ? "Скопировано" : "Скопировать настройки", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 15, weight: .heavy, design: .serif))
                            .foregroundStyle(Theme.bone)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(HellPanel(radius: 14))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 30)
            }
        }
        .preferredColorScheme(.dark)
    }
}
