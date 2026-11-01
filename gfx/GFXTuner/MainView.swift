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
                        Text(title).font(.system(size: 30, weight: .ultraLight)).foregroundStyle(Theme.ink)
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
            Text("DNS مشفّر 1.1.1.1 من Cloudflare. عناوين سيرفرات اللعبة تُحلّ أسرع وأكثر استقراراً، ومزوّد الإنترنت لا يرى إلى أين تتصل.")
                .font(Theme.serif(15)).foregroundStyle(Theme.ink.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Text("لا يؤثر DNS على البينغ أثناء القتال ولا على الضربات في الرأس — يعمل فقط لحظة البحث عن السيرفر.")
                .font(Theme.serif(13).italic()).foregroundStyle(Theme.ash)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 12) {
                step(1, "اضغط «تثبيت» — سيفتح Safari، اسمح بتنزيل الملف.")
                step(2, "الإعدادات ← عام ← VPN وإدارة الجهاز ← Lensy ← تثبيت.")
                step(3, "في نفس المكان: DNS ← اختر Lensy.")
                step(4, "إذا كان هناك ملف DNS آخر (مثل sevanDNS) احذفه — لا يعمل ملفان معاً.")
            }
            .padding(16)
            .background(Frame())

            Button { ProfileServer.shared.install() } label: {
                Text("تثبيت")
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.blood, lineWidth: 1))
            }
            .buttonStyle(.plain)

            Button { shareURL = LensyDNS.fileURL() } label: {
                Text("حفظ ملف التعريف")
                    .font(.system(size: 13)).foregroundStyle(Theme.ash)
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
        SheetScaffold(title: "الإعدادات") {
            VStack(alignment: .leading, spacing: 4) {
                Text("إصدار PUBG").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ash)
                    .padding(.bottom, 6)
                editionRow(id: "auto", name: "تلقائي", detail: GameLauncher.schemeWorks ? "تم العثور على اللعبة" : "")
                ForEach(GameEdition.all) { e in
                    editionRow(id: e.id, name: e.name, detail: "")
                }
            }
            .padding(16)
            .background(Frame())

            VStack(spacing: 14) {
                toggle("اقتحام تلقائي", "بعد الدخول ينظّف الذاكرة ويشغّل PUBG فوراً", $booster.autoLaunch)
                Rectangle().fill(Theme.faint).frame(height: 1)
                toggle("الحقن فوق PUBG", "شريط «حقن LENSY» في الجزيرة الديناميكية أثناء فتح اللعبة", $booster.inject)
                Rectangle().fill(Theme.faint).frame(height: 1)
                toggle("تذكير بالحرارة", "بعد 30 و60 و90 دقيقة من اللعب", Binding(
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

            Text("تنظيف الذاكرة: يشغل Lensy الذاكرة لثوانٍ فيُغلق iOS التطبيقات المصغّرة بنفسه. الذاكرة المحررة تذهب للعبة — تحميل وتقطيع أقل في بداية الجولة.")
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
