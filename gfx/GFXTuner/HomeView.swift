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
        Screen(title: "GFX Тюнер") {
            deviceCard
            readinessCard
            statsGrid
            checklist
            Button {
                GameLauncher.launch()
            } label: {
                Label("Открыть PUBG MOBILE", systemImage: "play.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .foregroundStyle(.black)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .padding(.top, 4)
        }
        .onAppear { m.refresh() }
    }

    private var deviceCard: some View {
        Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(m.model.name).font(.title2.bold())
                    Text("\(m.model.chip) · \(m.ramGB) ГБ ОЗУ · iOS \(m.iosVersion)")
                        .font(.subheadline).foregroundStyle(Theme.dim)
                }
                Spacer()
                Image(systemName: "iphone").font(.system(size: 34)).foregroundStyle(Theme.accent)
            }
            HStack(spacing: 6) {
                Text("Мощность:").foregroundStyle(Theme.dim)
                ForEach(0..<5, id: \.self) { i in
                    Image(systemName: i < m.model.tier.stars ? "star.fill" : "star")
                        .foregroundStyle(i < m.model.tier.stars ? Theme.accent : Theme.dim)
                        .font(.caption)
                }
                Text(m.model.tier.title).bold()
            }
            .font(.subheadline)
        }
    }

    private var readinessCard: some View {
        Card {
            HStack(spacing: 18) {
                ZStack {
                    Circle().stroke(Theme.card2, lineWidth: 12)
                    Circle()
                        .trim(from: 0, to: readiness)
                        .stroke(readinessColor, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.spring(), value: readiness)
                    Text("\(Int(readiness * 100))%").font(.title2.bold().monospacedDigit())
                }
                .frame(width: 96, height: 96)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Готовность к игре").font(.headline)
                    Text(readinessText).font(.subheadline).foregroundStyle(Theme.dim)
                }
            }
        }
    }

    private var readinessColor: Color {
        readiness >= 0.99 ? .green : readiness >= 0.6 ? Theme.accent : .red
    }

    private var readinessText: String {
        if readiness >= 0.99 { return "Всё готово, можно заходить." }
        let left = checks.filter { !$0.ok }.count
        return "Осталось пунктов: \(left). Пройди список ниже."
    }

    private var statsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            Stat(icon: "thermometer.medium", title: "Нагрев", value: m.thermalText, color: m.thermalColor)
            Stat(icon: "battery.75percent", title: "Батарея", value: m.batteryText,
                 color: (m.battery >= 0 && m.battery < 0.2 && !m.isCharging) ? .red : .green)
            Stat(icon: "display", title: "Экран", value: "\(m.screenHz) Гц", color: m.hasProMotion ? .green : .white)
            Stat(icon: "wifi", title: "Сеть", value: m.netType, color: m.online ? .green : .red)
            Stat(icon: "internaldrive", title: "Свободно", value: m.storageText, color: m.freeGB >= 3 ? .white : .orange)
            Stat(icon: "leaf.fill", title: "Энергосбер.", value: m.lowPower ? "Включён" : "Выключен", color: m.lowPower ? .orange : .green)
        }
    }

    private var checklist: some View {
        Card {
            Text("Подготовка к игре").font(.headline)
            ForEach(checks) { c in
                Button {
                    guard !c.auto else { return }
                    if manualDone.contains(c.id) { manualDone.remove(c.id) } else { manualDone.insert(c.id) }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: c.ok ? "checkmark.circle.fill" : (c.auto ? "exclamationmark.circle.fill" : "circle"))
                            .font(.title3)
                            .foregroundStyle(c.ok ? .green : (c.auto ? .orange : Theme.dim))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).foregroundStyle(.white)
                            if !c.ok {
                                Text(c.hint).font(.caption).foregroundStyle(Theme.dim)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                        if c.auto {
                            Text("авто").font(.caption2).foregroundStyle(Theme.dim)
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
            Text(value).font(.headline).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
