import SwiftUI

// MARK: - Графика

struct ProfilesView: View {
    @EnvironmentObject var m: SystemMonitor
    @State private var selected: Profile?
    @State private var copied = false

    private var recommended: Profile { Profile.recommended(for: m.model.tier) }
    private var current: Profile { selected ?? recommended }

    var body: some View {
        Screen(title: "Графика") {
            HStack(spacing: 8) {
                ForEach(Profile.allCases) { p in
                    Button { selected = p } label: {
                        VStack(spacing: 6) {
                            Image(systemName: p.icon).font(.title3)
                            Text(p.title).font(.caption.bold()).lineLimit(1).minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundStyle(current == p ? .black : .white)
                        .background(current == p ? Theme.accent : Theme.card,
                                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }

            let s = Recommender.settings(current, tier: m.model.tier, hz: m.screenHz)
            Card {
                HStack {
                    Text(current.title).font(.title2.bold())
                    if current == recommended {
                        Text("ДЛЯ ТЕБЯ")
                            .font(.caption2.bold())
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .foregroundStyle(.black)
                            .background(Color.green, in: Capsule())
                    }
                }
                Text(current.subtitle).font(.subheadline).foregroundStyle(Theme.dim)

                VStack(spacing: 0) {
                    ForEach(s.rows) { r in
                        HStack {
                            Text(r.name).foregroundStyle(Theme.dim)
                            Spacer()
                            Text(r.value).bold()
                        }
                        .padding(.vertical, 11)
                        if r.id != s.rows.last?.id { Divider().overlay(Theme.card2) }
                    }
                }

                if let w = s.warning {
                    Label(w, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline).foregroundStyle(.orange)
                }
                if m.thermal == .serious || m.thermal == .critical {
                    Label("iPhone сейчас горячий. Пока остывает, лучше профиль «Скорость».", systemImage: "thermometer.sun.fill")
                        .font(.subheadline).foregroundStyle(.red)
                }
            }

            Card {
                Text("Как применить").font(.headline)
                step(1, "Открой PUBG MOBILE → Настройки → Графика и звук.")
                step(2, "Выставь значения из таблицы выше.")
                step(3, "Если нужного пункта нет, выбери ближайший доступный: игра скрывает варианты, которые твой iPhone не тянет.")
                Button {
                    UIPasteboard.general.string = "PUBG — профиль «\(current.title)» для \(m.model.name):\n" +
                        s.rows.map { "\($0.name): \($0.value)" }.joined(separator: "\n")
                    copied = true
                } label: {
                    Label(copied ? "Скопировано" : "Скопировать настройки", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)

                Button { GameLauncher.launch() } label: {
                    Label("Открыть PUBG MOBILE", systemImage: "play.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .foregroundStyle(.black)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .onChange(of: selected) { _ in copied = false }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(.caption.bold()).frame(width: 22, height: 22)
                .foregroundStyle(.black).background(Theme.accent, in: Circle())
            Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Пинг

struct PingView: View {
    @EnvironmentObject var ping: PingTester
    @EnvironmentObject var m: SystemMonitor

    var body: some View {
        Screen(title: "Пинг") {
            Card {
                Text("Задержка до дата-центров в регионах, где стоят игровые серверы. В PUBG выбирай регион с самым низким пингом.")
                    .font(.subheadline).foregroundStyle(Theme.dim)
                HStack {
                    Label(m.netType, systemImage: m.netType == "Сотовая" ? "antenna.radiowaves.left.and.right" : "wifi")
                    Spacer()
                    if let b = ping.best, let r = ping.results[b.id] {
                        Text("Лучший: \(b.flag) \(Int(r.avg)) мс").bold().foregroundStyle(.green)
                    }
                }
                .font(.subheadline)
            }

            VStack(spacing: 10) {
                ForEach(ping.targets) { t in row(t) }
            }

            Button {
                Task { await ping.runAll() }
            } label: {
                HStack {
                    if ping.running { ProgressView().tint(.black) }
                    Text(ping.running ? "Проверяю…" : (ping.results.isEmpty ? "Проверить пинг" : "Проверить ещё раз"))
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .foregroundStyle(.black)
                .background(Theme.accent.opacity(ping.running ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .disabled(ping.running || !m.online)

            Text("Разброс — насколько пинг скачет. Больше 15–20 мс заметно в перестрелках: обычно виноваты Wi‑Fi через стену, загрузки в фоне или VPN.")
                .font(.caption).foregroundStyle(Theme.dim)
        }
    }

    private func row(_ t: PingTarget) -> some View {
        HStack(spacing: 12) {
            Text(t.flag).font(.title2)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.name).font(.subheadline.bold())
                if let r = ping.results[t.id] {
                    Text("разброс \(Int(r.jitter)) мс" + (r.loss > 0 ? " · потери \(r.loss)/\(PingTester.samples)" : ""))
                        .font(.caption).foregroundStyle(Theme.dim)
                }
            }
            Spacer()
            if ping.inProgress.contains(t.id) {
                ProgressView()
            } else if let r = ping.results[t.id] {
                Text("\(Int(r.avg)) мс").font(.title3.bold().monospacedDigit()).foregroundStyle(r.color)
            } else if ping.failed.contains(t.id) {
                Text("нет ответа").font(.caption).foregroundStyle(.red)
            } else {
                Text("—").foregroundStyle(Theme.dim)
            }
        }
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Советы

struct Tip: Identifiable {
    let id = UUID()
    let icon: String
    let title: String
    let text: String
}

struct TipsView: View {
    @EnvironmentObject var m: SystemMonitor

    var tips: [Tip] {
        var t: [Tip] = []
        if m.hasProMotion {
            t.append(Tip(icon: "speedometer", title: "Открой 120 Гц",
                         text: "Настройки → Универсальный доступ → Движение → выключи «Ограничение частоты кадров». Иначе iPhone не покажет больше 60 кадров даже при 120 FPS в игре."))
        }
        t += [
            Tip(icon: "leaf", title: "Не играй в энергосбережении",
                text: "Режим энергосбережения замедляет процессор\(m.hasProMotion ? " и режет экран до 60 Гц" : ""). Выключи его в Пункте управления перед игрой."),
            Tip(icon: "thermometer.snowflake", title: "Держи iPhone холодным",
                text: "Нагрев — главная причина просадок FPS. Сними толстый чехол, не играй на зарядке без нужды, не держи телефон на солнце или под одеялом."),
            Tip(icon: "moon.fill", title: "Фокусирование «Не беспокоить»",
                text: "Пункт управления → Фокусирование. Баннеры уведомлений не перекроют экран и не собьют свайп в бою."),
            Tip(icon: "arrow.clockwise", title: "Отключи фоновое обновление",
                text: "Настройки → Основные → Обновление контента. Меньше приложений будут греть телефон и качать данные во время катки."),
            Tip(icon: "wifi", title: "Wi‑Fi 5 ГГц и без VPN",
                text: "Подключайся к сети 5 ГГц ближе к роутеру. VPN добавляет пинг, если он не нужен — выключи. Проверь вкладку «Пинг»."),
            Tip(icon: "icloud.slash", title: "Пауза загрузок",
                text: "Обновления приложений, iCloud-фото и загрузки в фоне забирают канал. Начни катку, когда ничего не качается."),
            Tip(icon: "arrow.triangle.2.circlepath", title: "Перезагрузка раз в несколько дней",
                text: "Если iPhone долго не перезагружался и игра начала подлагивать, перезагрузи телефон перед серией каток."),
        ]
        return t
    }

    var body: some View {
        Screen(title: "Советы") {
            Card {
                Label("Почему это работает", systemImage: "info.circle").font(.headline)
                Text("iOS не даёт ни одному приложению менять настройки другой игры или закрывать её фоновые процессы. Поэтому реальный прирост дают правильные настройки в самом PUBG и системы iPhone. Всё ниже проверено на практике.")
                    .font(.subheadline).foregroundStyle(Theme.dim)
            }
            ForEach(tips) { tip in
                Card {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: tip.icon).font(.title3).foregroundStyle(Theme.accent).frame(width: 28)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(tip.title).font(.headline)
                            Text(tip.text).font(.subheadline).foregroundStyle(Theme.dim)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }
}
