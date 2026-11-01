import SwiftUI

struct Check: Identifiable {
    let id: String
    let title: String
    let hint: String
    let ok: Bool
    let auto: Bool
}

struct HomeView: View {
    @EnvironmentObject var m: SystemMonitor
    @EnvironmentObject var launcher: Launcher
    @State private var glow = false
    @State private var manualDone: Set<String> = []

    var checks: [Check] {
        var list: [Check] = [
            Check(id: "power", title: "Энергосбережение выключено",
                  hint: m.hasProMotion ? "Оно режет экран до 60 Гц и замедляет процессор" : "Оно замедляет процессор",
                  ok: !m.lowPower, auto: true),
            Check(id: "heat", title: "Телефон не перегрет",
                  hint: "Горячий iPhone сам сбрасывает частоту — будут просадки FPS",
                  ok: m.thermal == .nominal || m.thermal == .fair, auto: true),
            Check(id: "battery", title: "Заряда хватит на катку",
                  hint: "Нужно больше 20% или зарядка",
                  ok: m.isCharging || m.battery < 0 || m.battery > 0.2, auto: true),
            Check(id: "storage", title: "Есть свободное место",
                  hint: "Игре нужно хотя бы 3 ГБ для кеша и обновлений",
                  ok: m.totalGB == 0 || m.freeGB >= 3, auto: true),
            Check(id: "net", title: "Интернет подключён",
                  hint: m.lowData ? "Выключи «Экономию данных» в настройках сети" : "Лучше Wi‑Fi 5 ГГц рядом с роутером",
                  ok: m.online && !m.lowData, auto: true),
            Check(id: "apps", title: "Закрыл лишние приложения",
                  hint: "Смахни вверх ненужное в переключателе приложений, особенно камеру, навигатор, видео",
                  ok: manualDone.contains("apps"), auto: false),
            Check(id: "dnd", title: "Включил «Не беспокоить»",
                  hint: "Пункт управления → Фокусирование. Уведомления не вылезут посреди боя",
                  ok: manualDone.contains("dnd"), auto: false),
        ]
        if m.hasProMotion {
            list.append(Check(id: "fps", title: "Выключил «Ограничение частоты кадров»",
                              hint: "Настройки → Универсальный доступ → Движение. Иначе экран держит только 60 Гц",
                              ok: manualDone.contains("fps"), auto: false))
        }
        return list
    }

    var readiness: Double {
        let c = checks
        return Double(c.filter(\.ok).count) / Double(max(c.count, 1))
    }

    var body: some View {
        Screen(title: "") {
            hero
            readinessCard
            HellButton(title: "ПРИЗВАТЬ PUBG") { launcher.startCountdown() }
            autoCard
            deviceCard
            statsGrid
            checklist
        }
        .onAppear {
            m.refresh()
            withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) { glow = true }
        }
    }

    private var hero: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Theme.blood.opacity(glow ? 0.55 : 0.3), .clear],
                                         center: .center, startRadius: 10, endRadius: 170))
                    .frame(width: 340, height: 340)
                Image("Demon")
                    .resizable().scaledToFit()
                    .frame(width: 230, height: 230)
                    .shadow(color: Theme.blood.opacity(glow ? 0.95 : 0.5), radius: glow ? 30 : 14)
                    .scaleEffect(glow ? 1.03 : 1.0)
            }
            .frame(height: 250)
            Text("Lensy")
                .font(Theme.gothic(64))
                .foregroundStyle(Theme.bone)
                .shadow(color: Theme.blood, radius: glow ? 18 : 8)
                .padding(.top, -10)
            Text("تحسين الرؤية · OPTIMIZATION")
                .font(.system(size: 13, weight: .heavy, design: .serif))
                .tracking(2.5)
                .foregroundStyle(Theme.blood)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
    }

    private var autoCard: some View {
        Card {
            Toggle(isOn: $launcher.autoLaunch) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Автозапуск PUBG").font(.headline).foregroundStyle(Theme.bone)
                    Text("Открыл Lensy — через 3 секунды стартует игра. Можно отменить.")
                        .font(.caption).foregroundStyle(Theme.dim)
                }
            }
            .tint(Theme.blood)
            Divider().overlay(Theme.darkBlood)
            Toggle(isOn: $launcher.useShortcut) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Запуск через «Команды»").font(.subheadline.bold()).foregroundStyle(Theme.bone)
                    Text("Включи, если PUBG не открывается напрямую.")
                        .font(.caption).foregroundStyle(Theme.dim)
                }
            }
            .tint(Theme.blood)
            if launcher.useShortcut {
                Button("Как настроить команду") { launcher.showShortcutHelp = true }
                    .font(.caption.bold()).foregroundStyle(Theme.ember)
            }
        }
    }

    private var deviceCard: some View {
        Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(m.model.name).font(Theme.heading(22)).foregroundStyle(Theme.bone)
                    Text("\(m.model.chip) · \(m.ramGB) ГБ ОЗУ · iOS \(m.iosVersion)")
                        .font(.subheadline).foregroundStyle(Theme.dim)
                }
                Spacer()
                Image(systemName: "iphone.gen3").font(.system(size: 30)).foregroundStyle(Theme.blood)
                    .shadow(color: Theme.blood, radius: 8)
            }
            HStack(spacing: 5) {
                Text("Мощь:").foregroundStyle(Theme.dim)
                ForEach(0..<5, id: \.self) { i in
                    Image(systemName: "flame.fill")
                        .foregroundStyle(i < m.model.tier.stars ? Theme.blood : Theme.steel.opacity(0.3))
                        .shadow(color: i < m.model.tier.stars ? Theme.blood : .clear, radius: 4)
                        .font(.caption)
                }
                Text(m.model.tier.title).bold().foregroundStyle(Theme.bone)
            }
            .font(.subheadline)
        }
    }

    private var readinessCard: some View {
        HStack(spacing: 18) {
            ZStack {
                Circle().stroke(Theme.darkBlood.opacity(0.6), lineWidth: 13)
                Circle()
                    .trim(from: 0, to: readiness)
                    .stroke(AngularGradient(colors: [Theme.darkBlood, Theme.blood, Theme.ember, Theme.blood],
                                            center: .center),
                            style: StrokeStyle(lineWidth: 13, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .shadow(color: Theme.blood, radius: glow ? 12 : 5)
                    .animation(.spring(), value: readiness)
                VStack(spacing: 0) {
                    Text("\(Int(readiness * 100))%")
                        .font(.system(size: 26, weight: .black, design: .serif).monospacedDigit())
                        .foregroundStyle(Theme.bone)
                    Image(systemName: "flame.fill").font(.caption).foregroundStyle(Theme.ember)
                }
            }
            .frame(width: 104, height: 104)
            VStack(alignment: .leading, spacing: 6) {
                Text("Готовность к бою").font(Theme.heading(20)).foregroundStyle(Theme.bone)
                Text(readinessText).font(.subheadline).foregroundStyle(Theme.dim)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(HellPanel(radius: 22, lit: readiness >= 0.99))
    }

    private var readinessText: String {
        if readiness >= 0.99 { return "Всё готово. Можно призывать." }
        let left = checks.filter { !$0.ok }.count
        return "Осталось пунктов: \(left). Пройди ритуал ниже."
    }

    private var statsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            Stat(icon: "thermometer.medium", title: "Нагрев", value: m.thermalText, color: m.thermalColor)
            Stat(icon: "battery.75percent", title: "Батарея", value: m.batteryText,
                 color: (m.battery >= 0 && m.battery < 0.2 && !m.isCharging) ? .red : .green)
            Stat(icon: "display", title: "Экран", value: "\(m.screenHz) Гц", color: m.hasProMotion ? .green : Theme.bone)
            Stat(icon: "wifi", title: "Сеть", value: m.netType, color: m.online ? .green : .red)
            Stat(icon: "internaldrive", title: "Свободно", value: m.storageText, color: m.freeGB >= 3 ? Theme.bone : .orange)
            Stat(icon: "leaf.fill", title: "Энергосбер.", value: m.lowPower ? "Включён" : "Выключен", color: m.lowPower ? .orange : .green)
        }
    }

    private var checklist: some View {
        Card {
            Text("Ритуал перед игрой").font(Theme.heading(20)).foregroundStyle(Theme.bone)
            ForEach(checks) { c in
                Button {
                    guard !c.auto else { return }
                    if manualDone.contains(c.id) { manualDone.remove(c.id) } else { manualDone.insert(c.id) }
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: c.ok ? "checkmark.seal.fill" : (c.auto ? "exclamationmark.triangle.fill" : "circle"))
                            .font(.title3)
                            .foregroundStyle(c.ok ? Theme.blood : (c.auto ? .orange : Theme.steel))
                            .shadow(color: c.ok ? Theme.blood : .clear, radius: 6)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).foregroundStyle(c.ok ? Theme.bone : Theme.bone.opacity(0.85))
                            if !c.ok {
                                Text(c.hint).font(.caption).foregroundStyle(Theme.dim)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                        if c.auto {
                            Text("авто").font(.caption2).foregroundStyle(Theme.steel)
                        }
                    }
                    .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct Stat: View {
    let icon: String
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: icon).font(.caption).foregroundStyle(Theme.dim)
            Text(value).font(.system(.headline, design: .serif).weight(.heavy))
                .foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HellPanel(radius: 16))
    }
}
