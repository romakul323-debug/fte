import UIKit
import Capacitor
import AVFoundation

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = VolnaBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}


// Своя «оболочка» Capacitor: подключает плагин звонка
class VolnaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VolnaCallPlugin())
    }
}

// «Служба звонка» для iOS: на время звонка переводит звук в режим разговора,
// чтобы iOS не глушил звонок, когда приложение свёрнуто (нужен UIBackgroundModes = audio).
@objc(VolnaCallPlugin)
public class VolnaCallPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VolnaCallPlugin"
    public let jsName = "VolnaCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private var active = false

    override public func load() {
        // после прерывания (входящий звонок, Siri) возвращаем звук обратно
        NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption(_:)),
                                               name: AVAudioSession.interruptionNotification, object: nil)
    }

    @objc func start(_ call: CAPPluginCall) {
        activate()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        active = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        call.resolve()
    }

    private func activate() {
        active = true
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat,
                                    options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            CAPLog.print("VolnaCall: audio session error \(error)")
        }
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard active,
              let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        activate()
        notifyListeners("resumed", data: [:])
    }
}
