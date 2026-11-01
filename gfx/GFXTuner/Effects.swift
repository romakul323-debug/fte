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
            Scanlines()
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
        "الصمت قبل الطلقة الأولى",
        "أحدهم مختبئ في العشب",
        "المنطقة تضيق",
        "لست وحدك في هذه الجولة",
        "لا تحدّق في الشجيرات طويلاً",
        "الدائرة الأخيرة دائماً أهدأ",
        "هو يراك الآن",
    ]
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let period = 7.0
            let i = Int(t / period) % lines.count
            let p = (t / period).truncatingRemainder(dividingBy: 1)
            let a = max(0, sin(p * .pi)) * 0.5
            Text(lines[i])
                .font(.system(size: 14, weight: .light))
                .foregroundStyle(Theme.ash.opacity(a))
        }
    }
}

/// Глаз во тьме: изредка медленно открывается, водит зрачком и закрывается.
struct DarkEye: View {
    var period: Double = 11
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let cyc = t.truncatingRemainder(dividingBy: period)
            let open: Double = cyc < 1.4 ? cyc / 1.4 : cyc < 4.5 ? 1 : cyc < 5.1 ? 1 - (cyc - 4.5) / 0.6 : 0
            let look = sin(t * 0.9) * 0.4
            Canvas { ctx, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2)
                let ew = size.width * 0.46
                let eh = size.height * 0.5 * open
                var lid = Path()
                lid.move(to: CGPoint(x: c.x - ew, y: c.y))
                lid.addQuadCurve(to: CGPoint(x: c.x + ew, y: c.y), control: CGPoint(x: c.x, y: c.y - eh * 2))
                lid.addQuadCurve(to: CGPoint(x: c.x - ew, y: c.y), control: CGPoint(x: c.x, y: c.y + eh * 2))
                // свечение
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - ew, y: c.y - size.height * 0.6, width: ew * 2, height: size.height * 1.2)),
                         with: .radialGradient(Gradient(colors: [Theme.blood.opacity(0.35 * open), .clear]),
                                               center: c, startRadius: 0, endRadius: ew))
                ctx.stroke(lid, with: .color(Theme.bloodLight.opacity(0.15 + 0.6 * open)), lineWidth: 1)
                if open > 0.02 {
                    ctx.drawLayer { l in
                        l.clip(to: lid)
                        let r = size.height * 0.42
                        let ic = CGPoint(x: c.x + look * ew * 0.6, y: c.y)
                        l.fill(Path(ellipseIn: CGRect(x: ic.x - r, y: ic.y - r, width: 2 * r, height: 2 * r)),
                               with: .radialGradient(Gradient(colors: [Color(red: 1, green: 0.35, blue: 0.2), Theme.bloodLight, Theme.blood]),
                                                     center: ic, startRadius: 0, endRadius: r))
                        var slit = Path()
                        slit.move(to: CGPoint(x: ic.x, y: ic.y - r * 0.9))
                        slit.addQuadCurve(to: CGPoint(x: ic.x, y: ic.y + r * 0.9), control: CGPoint(x: ic.x + r * 0.22, y: ic.y))
                        slit.addQuadCurve(to: CGPoint(x: ic.x, y: ic.y - r * 0.9), control: CGPoint(x: ic.x - r * 0.22, y: ic.y))
                        l.fill(slit, with: .color(.black))
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}

/// Полосы старого монитора + мигание, как от умирающей лампы.
struct Scanlines: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let cyc = t.truncatingRemainder(dividingBy: 9.7)
            let flick = (cyc > 3.0 && cyc < 3.08) || (cyc > 3.16 && cyc < 3.22) ? 0.55 : 0.0
            Canvas { ctx, size in
                var y = 0.0
                while y < size.height {
                    ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(.white.opacity(0.025)))
                    y += 3
                }
                let band = (t * 60).truncatingRemainder(dividingBy: size.height + 120) - 60
                ctx.fill(Path(CGRect(x: 0, y: band, width: size.width, height: 60)),
                         with: .linearGradient(Gradient(colors: [.clear, .white.opacity(0.03), .clear]),
                                               startPoint: CGPoint(x: 0, y: band), endPoint: CGPoint(x: 0, y: band + 60)))
                if flick > 0 { ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.black.opacity(flick))) }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
