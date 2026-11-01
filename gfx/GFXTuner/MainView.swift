import SwiftUI

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
                toggle("Автозалёт", "После входа сразу чистит ОЗУ и запускает PUBG", $booster.autoLaunch)
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
