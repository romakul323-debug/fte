import ActivityKit
import SwiftUI
import WidgetKit

private let blood = Color(red: 0.80, green: 0.08, blue: 0.10)
private let ink = Color(white: 0.9)
private let ash = Color(white: 0.5)

@main
struct LensyLiveBundle: WidgetBundle {
    var body: some Widget { InjectLive() }
}

struct InjectLive: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: InjectAttributes.self) { ctx in
            LockView(state: ctx.state, game: ctx.attributes.game)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(blood)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("LENSY").font(.system(size: 14, weight: .ultraLight, design: .serif)).tracking(4).foregroundStyle(ink)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(pct(ctx.state.progress)).font(.system(size: 16, weight: .bold, design: .monospaced))
                        .foregroundStyle(ctx.state.done ? ink : blood)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(ctx.state.done ? "تم الحقن ✓" : "حقن LENSY في \(ctx.attributes.game)…")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(ink)
                        Bar(progress: ctx.state.progress)
                        Text(ctx.state.step).font(.system(size: 11)).foregroundStyle(ash)
                    }
                    .environment(\.layoutDirection, .rightToLeft)
                }
            } compactLeading: {
                Image(systemName: ctx.state.done ? "checkmark" : "syringe.fill").foregroundStyle(blood)
            } compactTrailing: {
                Text(pct(ctx.state.progress)).font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundStyle(ink)
            } minimal: {
                ZStack {
                    Circle().stroke(Color(white: 0.2), lineWidth: 2)
                    Circle().trim(from: 0, to: ctx.state.progress).stroke(blood, lineWidth: 2).rotationEffect(.degrees(-90))
                }
            }
            .keylineTint(blood)
        }
    }
}

private func pct(_ p: Double) -> String { "\(Int(p * 100))%" }

struct Bar: View {
    let progress: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(white: 0.15))
                Capsule().fill(LinearGradient(colors: [blood, Color(red: 1, green: 0.3, blue: 0.2)], startPoint: .trailing, endPoint: .leading))
                    .frame(width: max(4, g.size.width * progress))
            }
        }
        .frame(height: 4)
    }
}

struct LockView: View {
    let state: InjectAttributes.ContentState
    let game: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(state.done ? "تم الحقن ✓" : "حقن LENSY في \(game)").font(.system(size: 16, weight: .semibold)).foregroundStyle(ink)
                Spacer()
                Text(pct(state.progress)).font(.system(size: 22, weight: .ultraLight, design: .monospaced)).foregroundStyle(blood)
            }
            Bar(progress: state.progress)
            Text(state.step).font(.system(size: 12)).foregroundStyle(ash)
        }
        .padding(16)
        .environment(\.layoutDirection, .rightToLeft)
    }
}
