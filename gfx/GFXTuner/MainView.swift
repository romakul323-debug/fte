import SwiftUI

enum SheetKind: String, Identifiable {
    case graphics, sens, settings
    var id: String { rawValue }
}

struct MainView: View {
    @EnvironmentObject var m: SystemMonitor
    @EnvironmentObject var booster: Booster
    @State private var sheet: SheetKind?
    @State private var appeared = false

    private var compact: Bool { UIScreen.main.bounds.height < 740 }

    var body: some View {
        ZStack {
            HellBackground()

            VStack(spacing: 0) {
                Spacer(minLength: compact ? 14 : 30)
                DemonSkull(size: compact ? 140 : 185)
                    .frame(height: compact ? 150 : 205)
                    .opacity(appeared ? 1 : 0)
                    .scaleEffect(appeared ? 1 : 0.9)

                Text("Lensy")
                    .font(Theme.gothic(56))
                    .foregroundStyle(Theme.bone)
                    .shadow(color: Theme.blood, radius: 14)
                    .padding(.top, -6)
                    .opacity(appeared ? 1 : 0)
                Text("تحسين الرؤية · \(booster.edition.name)")
                    .font(.system(size: 14, weight: .heavy, design: .serif))
                    .foregroundStyle(Theme.blood)
                    .opacity(appeared ? 1 : 0)

                Spacer(minLength: compact ? 8 : 18)

                BoostButton { booster.start(monitor: m) }
                    .frame(width: 210, height: 210)
                    .scaleEffect(compact ? 0.85 : 1)

                Spacer(minLength: compact ? 8 : 22)

                statsRow.padding(.horizontal, 16)

                HStack(spacing: 10) {
                    MenuButton(icon: "slider.horizontal.3", title: "Графика") { sheet = .graphics }
                    MenuButton(icon: "scope", title: "Сенса") { sheet = .sens }
                    MenuButton(icon: "gearshape.fill", title: "Настройки") { sheet = .settings }
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 18)
            }

            if booster.active {
                BoostOverlay().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: booster.active)
        .sheet(item: $sheet) { kind in
            Group {
                switch kind {
                case .graphics: GraphicsSheet()
                case .sens: SensSheet()
                case .settings: SettingsSheet()
                }
            }
            .environmentObject(m)
            .environmentObject(booster)
        }
        .onAppear {
            m.refresh()
            withAnimation(.easeOut(duration: 0.9)) { appeared = true }
        }
    }

    private var pingColor: Color {
        guard let p = booster.bestPing else { return Theme.steel }
        if p.ms < 60 { return .green }
        if p.ms < 120 { return .yellow }
        return .red
    }

    private var statsRow: some View {
        TimelineView(.periodic(from: .now, by: 3)) { _ in
            HStack(spacing: 10) {
                Chip(icon: "thermometer.medium", label: "нагрев", value: m.thermalText, color: m.thermalColor)
                Chip(icon: "memorychip", label: "ОЗУ своб.", value: RAMCleaner.gb(RAMCleaner.freeMB()), color: Theme.bone)
                Chip(icon: "dot.radiowaves.left.and.right", label: "пинг",
                     value: booster.bestPing.map { "\($0.ms) мс" } ?? "—", color: pingColor)
                Chip(icon: "battery.75percent", label: "заряд", value: m.batteryText,
                     color: (m.battery >= 0 && m.battery < 0.2 && !m.isCharging) ? .red : Theme.bone)
            }
        }
    }
}

struct Chip: View {
    let icon: String
    let label: String
    let value: String
    let color: Color
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.caption).foregroundStyle(Theme.blood)
            Text(value).font(.system(size: 13, weight: .heavy, design: .serif))
                .foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.steel)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .background(HellPanel(radius: 14))
    }
}

struct MenuButton: View {
    let icon: String
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.blood)
                Text(title).font(.system(size: 13, weight: .heavy, design: .serif)).foregroundStyle(Theme.bone)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(HellPanel(radius: 14))
        }
        .buttonStyle(.plain)
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
                            Text("ОЗУ · пинг · запуск")
                                .font(.system(size: 10, weight: .heavy, design: .serif))
                                .foregroundStyle(Theme.bone.opacity(0.8))
                        }
                    }
                    .frame(width: 150, height: 150)
                    .shadow(color: Theme.blood.opacity(0.6 + 0.4 * beat), radius: 18 + 26 * beat)
                    .scaleEffect((pressed ? 0.93 : 1) * (1 + 0.03 * beat))
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
            Color.black.opacity(0.94).ignoresSafeArea()
            HellBackground(intensity: 1.3)

            VStack(spacing: 12) {
                ZStack {
                    Circle().stroke(Theme.clot, lineWidth: 6)
                    Circle()
                        .trim(from: 0, to: booster.progress)
                        .stroke(AngularGradient(colors: [Theme.darkBlood, Theme.blood, Theme.ember, Theme.blood], center: .center),
                                style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .shadow(color: Theme.blood, radius: 8)
                    DemonSkull(size: 118)
                }
                .frame(width: 180, height: 180)
                .padding(.top, 44)

                Text(title)
                    .font(Theme.gothic(34))
                    .foregroundStyle(Theme.bone)
                    .shadow(color: Theme.blood, radius: 10)
                Text("\(Int(booster.progress * 100))%")
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.blood)

                VStack(spacing: 0) {
                    ForEach(booster.lines) { line in
                        LineRow(line: line)
                            .transition(.opacity)
                        if line.id != booster.lines.last?.id {
                            Rectangle().fill(Theme.darkBlood.opacity(0.6)).frame(height: 1)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .background(booster.lines.isEmpty ? nil : HellPanel(radius: 16))
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
        case .running: return "Boosting"
        case .done: return "Ready"
        case .launching: return "Launching PUBG"
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
                    case .work: ProgressView().tint(Theme.blood).scaleEffect(0.7)
                    case .ok: Image(systemName: "checkmark").foregroundStyle(Theme.blood)
                    case .warn: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                }
                .font(.system(size: 13, weight: .black))
                .frame(width: 18)
                Text(line.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.dim)
                Spacer()
                Text(line.value).font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundStyle(Theme.bone)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            if let h = line.hint {
                Text(h).font(.caption).foregroundStyle(.orange).padding(.leading, 28)
            }
        }
        .padding(.vertical, 9)
    }
}

// MARK: - Шторки

struct SheetScaffold<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack {
            HellBackground(intensity: 0.6)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text(title).font(Theme.heading(28)).foregroundStyle(Theme.bone)
                            .shadow(color: Theme.blood, radius: 10)
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.headline).foregroundStyle(Theme.steel)
                                .padding(10).background(HellPanel(radius: 20))
                        }
                    }
                    .padding(.top, 50)
                    content
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 30)
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct Segmented<T: Hashable>: View {
    let items: [(T, String, String)]   // значение, иконка, подпись
    @Binding var selection: T
    var body: some View {
        HStack(spacing: 8) {
            ForEach(items, id: \.0) { item in
                Button { selection = item.0 } label: {
                    VStack(spacing: 5) {
                        Image(systemName: item.1).font(.title3)
                        Text(item.2).font(.caption.bold()).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .foregroundStyle(selection == item.0 ? Theme.bone : Theme.steel)
                    .background {
                        if selection == item.0 {
                            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.hellGradient)
                                .shadow(color: Theme.blood.opacity(0.8), radius: 10)
                        } else {
                            HellPanel(radius: 14)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct TableCard: View {
    let title: String?
    let rows: [SettingRow]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let title { Text(title).font(Theme.heading(18)).foregroundStyle(Theme.bone).padding(.bottom, 4) }
            ForEach(rows) { r in
                HStack {
                    Text(r.name).foregroundStyle(Theme.dim)
                    Spacer()
                    Text(r.value).font(.system(.body, design: .monospaced).weight(.bold)).foregroundStyle(Theme.bone)
                }
                .font(.subheadline)
                .padding(.vertical, 7)
                if r.id != rows.last?.id { Rectangle().fill(Theme.darkBlood.opacity(0.6)).frame(height: 1) }
            }
        }
        .padding(16)
        .background(HellPanel(radius: 18))
    }
}

struct CopyButton: View {
    let text: () -> String
    @State private var copied = false
    var body: some View {
        Button {
            UIPasteboard.general.string = text()
            copied = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } label: {
            Label(copied ? "Скопировано" : "Скопировать", systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(.system(size: 15, weight: .heavy, design: .serif))
                .foregroundStyle(Theme.bone)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(HellPanel(radius: 14))
        }
        .buttonStyle(.plain)
    }
}

struct GraphicsSheet: View {
    @EnvironmentObject var m: SystemMonitor
    @State private var selected: Profile = .balanced
    @State private var didInit = false

    var body: some View {
        let s = Recommender.settings(selected, tier: m.model.tier, hz: m.screenHz)
        SheetScaffold(title: "Графика PUBG") {
            Text("\(m.model.name) · \(m.model.chip) · \(m.screenHz) Гц").font(.subheadline).foregroundStyle(Theme.dim)
            Segmented(items: Profile.allCases.map { ($0, $0.icon, $0.title) }, selection: $selected)
            HStack {
                Text(selected.subtitle).font(.subheadline).foregroundStyle(Theme.dim)
                if selected == Profile.recommended(for: m.model.tier) {
                    Text("ДЛЯ ТЕБЯ").font(.caption2.bold()).padding(.horizontal, 8).padding(.vertical, 4)
                        .foregroundStyle(Theme.bone).background(Theme.blood, in: Capsule())
                }
            }
            TableCard(title: nil, rows: s.rows)
            if let w = s.warning {
                Label(w, systemImage: "exclamationmark.triangle.fill").font(.subheadline).foregroundStyle(.orange)
            }
            Text("PUBG → Настройки → Графика и звук. Если пункта нет — бери ближайший доступный.")
                .font(.caption).foregroundStyle(Theme.dim)
            CopyButton { "PUBG — «\(selected.title)» для \(m.model.name):\n" + s.rows.map { "\($0.name): \($0.value)" }.joined(separator: "\n") }
        }
        .onAppear {
            guard !didInit else { return }
            didInit = true
            selected = Profile.recommended(for: m.model.tier)
        }
    }
}

struct SensSheet: View {
    @State private var style: SensStyle = .thumbs
    var body: some View {
        SheetScaffold(title: "Чувствительность") {
            Text("Стартовые значения под размер твоего экрана. Поиграй пару каток и сдвигай на 5–10%, пока прицел не перестанет «уезжать».")
                .font(.subheadline).foregroundStyle(Theme.dim)
            Segmented(items: SensStyle.allCases.map { ($0, $0 == .thumbs ? "hand.tap.fill" : "gyroscope", $0.title) },
                      selection: $style)
            ForEach(SensCalc.sections(style)) { sec in
                TableCard(title: sec.title, rows: sec.rows)
            }
            Text("PUBG → Настройки → Чувствительность.").font(.caption).foregroundStyle(Theme.dim)
            CopyButton { "PUBG — чувствительность (\(style.title)):\n\n" + SensCalc.text(style) }
        }
    }
}

struct SettingsSheet: View {
    @EnvironmentObject var booster: Booster

    var body: some View {
        SheetScaffold(title: "Настройки") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Версия PUBG").font(Theme.heading(18)).foregroundStyle(Theme.bone)
                editionRow(id: "auto", name: "Авто", detail: "Найду установленную сам")
                ForEach(GameEdition.all) { e in
                    editionRow(id: e.id, name: e.name, detail: installedText(e))
                }
            }
            .padding(16)
            .background(HellPanel(radius: 18))

            VStack(spacing: 14) {
                toggle("Автозапуск", "При открытии Lensy сразу делает BOOST и запускает PUBG", $booster.autoLaunch)
                Rectangle().fill(Theme.darkBlood.opacity(0.6)).frame(height: 1)
                toggle("Напоминание о перегреве", "Уведомления через 30, 60 и 90 минут игры", Binding(
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
            .background(HellPanel(radius: 18))

            Text("Очистка ОЗУ: Lensy ненадолго занимает память, и iOS сама выгружает свёрнутые приложения. Освободившаяся память достаётся игре. Свёрнутые приложения потом откроются заново.")
                .font(.caption).foregroundStyle(Theme.dim)
        }
    }

    private func installedText(_ e: GameEdition) -> String {
        switch GameLauncher.isInstalled(e) {
        case .some(true): return "установлена"
        case .some(false): return "не найдена"
        case .none: return ""
        }
    }

    private func editionRow(id: String, name: String, detail: String) -> some View {
        Button { booster.editionChoice = id } label: {
            HStack {
                Image(systemName: booster.editionChoice == id ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(booster.editionChoice == id ? Theme.blood : Theme.steel)
                Text(name).font(.system(size: 16, weight: .bold, design: .serif)).foregroundStyle(Theme.bone)
                Spacer()
                Text(detail).font(.caption).foregroundStyle(detail == "установлена" ? .green : Theme.steel)
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }

    private func toggle(_ title: String, _ sub: String, _ binding: Binding<Bool>) -> some View {
        Toggle(isOn: binding) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 16, weight: .bold, design: .serif)).foregroundStyle(Theme.bone)
                Text(sub).font(.caption).foregroundStyle(Theme.dim)
            }
        }
        .tint(Theme.blood)
    }
}
