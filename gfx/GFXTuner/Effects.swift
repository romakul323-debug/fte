import SwiftUI

/// Сердцебиение: двойной удар раз в ~1.1 с, значение 0…1.
func heartbeat(_ t: Double, period: Double = 1.1) -> Double {
    let p = t.truncatingRemainder(dividingBy: period)
    let a = exp(-pow((p - 0.05) / 0.06, 2))
    let b = 0.65 * exp(-pow((p - 0.30) / 0.07, 2))
    return max(a, b)
}

/// Тьма, багровый туман, угли, кровь сверху, пульсирующая виньетка.
struct HellBackground: View {
    var intensity: Double = 1
    var body: some View {
        ZStack {
            Theme.bg
            RadialGradient(colors: [Theme.darkBlood.opacity(0.75), .clear], center: .top, startRadius: 0, endRadius: 480)
            RadialGradient(colors: [Theme.clot.opacity(0.9), .clear], center: .bottom, startRadius: 0, endRadius: 380)
            EmberField()
            BloodDrips()
            HeartbeatVignette(intensity: intensity)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

struct HeartbeatVignette: View {
    var intensity: Double = 1
    var period: Double = 1.1
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let beat = heartbeat(tl.date.timeIntervalSinceReferenceDate, period: period)
            RadialGradient(colors: [.clear, Theme.blood.opacity((0.12 + 0.38 * beat) * intensity)],
                           center: .center, startRadius: 170, endRadius: 560)
        }
    }
}

struct EmberField: View {
    private struct Ember { let x, speed, size, phase, sway: Double }
    private let embers: [Ember] = (0..<44).map { _ in
        Ember(x: .random(in: 0...1), speed: .random(in: 0.025...0.08), size: .random(in: 1.2...3.4),
              phase: .random(in: 0...1), sway: .random(in: 6...22))
    }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSinceReferenceDate
                for e in embers {
                    let p = (e.phase + t * e.speed).truncatingRemainder(dividingBy: 1)
                    let y = size.height * (1.05 - p * 1.1)
                    let x = size.width * e.x + sin(t * 1.1 + e.phase * 12) * e.sway
                    let a = sin(p * .pi)
                    let r = e.size
                    ctx.fill(Path(ellipseIn: CGRect(x: x - r * 3, y: y - r * 3, width: r * 6, height: r * 6)),
                             with: .color(Theme.blood.opacity(0.16 * a)))
                    ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                             with: .color(Theme.ember.opacity(0.9 * a)))
                }
            }
        }
    }
}

/// Кровь стекает с верхнего края, иногда срываются капли.
struct BloodDrips: View {
    private struct Drip { let x, width, base, amp, speed, phase, fall: Double }
    private let drips: [Drip] = (0..<16).map { i in
        Drip(x: (Double(i) + .random(in: 0.1...0.9)) / 16, width: .random(in: 5...13),
             base: .random(in: 18...70), amp: .random(in: 8...40), speed: .random(in: 0.25...0.7),
             phase: .random(in: 0...6.28), fall: .random(in: 3.5...9))
    }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSinceReferenceDate
                let shade = GraphicsContext.Shading.linearGradient(
                    Gradient(colors: [Theme.clot, Theme.darkBlood, Theme.blood]),
                    startPoint: .zero, endPoint: CGPoint(x: 0, y: 140))
                // кровавая кромка сверху
                var top = Path()
                top.move(to: .zero)
                let steps = 40
                for s in 0...steps {
                    let x = size.width * Double(s) / Double(steps)
                    top.addLine(to: CGPoint(x: x, y: 10 + 5 * sin(Double(s) * 1.7 + t * 0.4)))
                }
                top.addLine(to: CGPoint(x: size.width, y: 0))
                top.closeSubpath()
                ctx.fill(top, with: shade)

                for d in drips {
                    let len = d.base + d.amp * (0.5 + 0.5 * sin(t * d.speed + d.phase))
                    let x = d.x * size.width
                    let w = d.width
                    let body = Path(roundedRect: CGRect(x: x - w / 2, y: 0, width: w, height: len), cornerRadius: w / 2)
                    ctx.fill(body, with: shade)
                    let r = w * 0.75
                    ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: len - r * 1.3, width: r * 2, height: r * 2.3)), with: .color(Theme.blood))
                    // блик
                    ctx.fill(Path(ellipseIn: CGRect(x: x - r * 0.45, y: len - r * 0.9, width: r * 0.5, height: r * 0.7)),
                             with: .color(.white.opacity(0.25)))
                    // сорвавшаяся капля
                    let fp = (t / d.fall + d.phase).truncatingRemainder(dividingBy: 1)
                    if fp < 0.55 {
                        let k = fp / 0.55
                        let y = len + k * k * size.height
                        let dr = r * 0.7
                        ctx.fill(Path(ellipseIn: CGRect(x: x - dr, y: y - dr * 1.4, width: dr * 2, height: dr * 2.6)),
                                 with: .color(Theme.blood.opacity(1 - k * 0.6)))
                    }
                }
            }
        }
    }
}

/// Пентаграмма для рунного круга.
struct Pentagram: Shape {
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = min(rect.width, rect.height) / 2
        let pts = (0..<5).map { i -> CGPoint in
            let a = -Double.pi / 2 + Double(i) * 2 * .pi / 5
            return CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a))
        }
        var p = Path()
        p.move(to: pts[0])
        for i in [2, 4, 1, 3, 0] { p.addLine(to: pts[i]) }
        p.addEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
        return p
    }
}

/// Вращающиеся рунные кольца вокруг кнопки.
struct RuneRings: View {
    var speed: Double = 1
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let beat = heartbeat(t)
            ZStack {
                Pentagram()
                    .stroke(Theme.blood.opacity(0.35 + 0.3 * beat), lineWidth: 1.5)
                    .rotationEffect(.degrees(t * 6 * speed))
                    .shadow(color: Theme.blood, radius: 6)
                Circle()
                    .stroke(Theme.blood.opacity(0.7), style: StrokeStyle(lineWidth: 2, dash: [2, 9]))
                    .padding(-14)
                    .rotationEffect(.degrees(-t * 14 * speed))
                Circle()
                    .stroke(Theme.darkBlood, style: StrokeStyle(lineWidth: 5, dash: [22, 8, 4, 8]))
                    .padding(-26)
                    .rotationEffect(.degrees(t * 9 * speed))
            }
        }
    }
}

/// Череп: пульсирует, иногда «мерцает», при тряске дёргается.
struct DemonSkull: View {
    var size: CGFloat = 220
    var shaking = false
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let beat = heartbeat(t)
            let jx = shaking ? Double.random(in: -4...4) : 0
            let jy = shaking ? Double.random(in: -3...3) : 0
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Theme.blood.opacity(0.35 + 0.3 * beat), .clear],
                                         center: .center, startRadius: 5, endRadius: size * 0.75))
                    .frame(width: size * 1.5, height: size * 1.5)
                Image("Demon")
                    .resizable().scaledToFit()
                    .frame(width: size, height: size)
                    .shadow(color: Theme.blood.opacity(0.5 + 0.5 * beat), radius: 12 + 22 * beat)
                    .scaleEffect(1 + 0.025 * beat)
                    .offset(x: jx, y: jy)
            }
        }
    }
}
