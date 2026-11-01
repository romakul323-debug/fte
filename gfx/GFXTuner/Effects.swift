import SwiftUI

/// Медленное «дыхание», 0…1.
func breath(_ t: Double, period: Double = 6) -> Double {
    0.5 - 0.5 * cos(t * 2 * .pi / period)
}

/// Чернота с плёночным зерном, медленным туманом и дышащей виньеткой.
struct Darkness: View {
    var fog: Double = 1
    var body: some View {
        ZStack {
            Theme.bg
            TimelineView(.animation(minimumInterval: 1.0 / 12)) { tl in
                let t = tl.date.timeIntervalSinceReferenceDate
                let b = breath(t)
                ZStack {
                    RadialGradient(colors: [Color(white: 0.09 + 0.04 * b * fog), .clear],
                                   center: UnitPoint(x: 0.5 + 0.08 * sin(t / 9), y: 0.42),
                                   startRadius: 0, endRadius: 360)
                    RadialGradient(colors: [Theme.blood.opacity(0.10 * fog * b), .clear],
                                   center: .bottom, startRadius: 0, endRadius: 420)
                    Grain(seed: Int(t * 12))
                    RadialGradient(colors: [.clear, .black.opacity(0.85)], center: .center,
                                   startRadius: 180 + 30 * b, endRadius: 560)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

/// Плёночное зерно.
struct Grain: View {
    let seed: Int
    var body: some View {
        Canvas { ctx, size in
            var rng = SplitMix(seed: UInt64(truncatingIfNeeded: seed))
            for _ in 0..<700 {
                let x = Double(rng.next() % 10_000) / 10_000 * size.width
                let y = Double(rng.next() % 10_000) / 10_000 * size.height
                let a = Double(rng.next() % 100) / 100 * 0.10
                ctx.fill(Path(CGRect(x: x, y: y, width: 1, height: 1)), with: .color(.white.opacity(a)))
            }
        }
    }
}

struct SplitMix {
    var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

/// Текст, который изредка «сбоит»: на миг съезжает и оставляет красную тень.
struct GlitchText: View {
    let text: String
    let font: Font
    var color: Color = Theme.ink
    var tracking: CGFloat = 0
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let cycle = t.truncatingRemainder(dividingBy: 7.3)
            let on = cycle < 0.14 || (cycle > 0.22 && cycle < 0.28)
            ZStack {
                if on {
                    Text(text).font(font).tracking(tracking).foregroundStyle(Theme.bloodLight.opacity(0.7))
                        .offset(x: 2.5, y: -1)
                }
                Text(text).font(font).tracking(tracking).foregroundStyle(color)
                    .offset(x: on ? -1.5 : 0)
                    .opacity(on ? 0.75 : 1)
            }
        }
    }
}

/// Шёпот внизу экрана: фразы медленно проявляются и тают.
struct Whisper: View {
    private let lines = [
        "тишина перед первым выстрелом",
        "кто-то уже лежит в траве",
        "зона сужается",
        "ты не один в этой катке",
        "не смотри в кусты слишком долго",
        "последний круг всегда тише",
    ]
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let period = 7.0
            let i = Int(t / period) % lines.count
            let p = (t / period).truncatingRemainder(dividingBy: 1)
            let a = max(0, sin(p * .pi)) * 0.5
            Text(lines[i])
                .font(Theme.serif(13).italic())
                .tracking(1.5)
                .foregroundStyle(Theme.ash.opacity(a))
        }
    }
}
