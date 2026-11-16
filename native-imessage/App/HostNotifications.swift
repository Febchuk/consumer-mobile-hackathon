import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class HostNotifications: ObservableObject {
    static let shared = HostNotifications()
    @Published private(set) var status = "Not requested"
    @Published private(set) var error: String?

    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            status = "Allowed"
            UIApplication.shared.registerForRemoteNotifications()
        case .denied:
            status = "Off in iOS Settings"
            await unregister()
        case .notDetermined: status = "Not requested"
        @unknown default: status = "Unavailable"
        }
    }

    func requestPermission() async {
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            if allowed { UIApplication.shared.registerForRemoteNotifications() }
            else { await unregister() }
            await refresh()
        } catch { self.error = "Couldn't change notification permission. You can still open Called It manually." }
    }

    func registered(deviceToken: Data) async {
        do {
            let configuration = try Config.load()
            guard let session = try SessionStore.load(configuration: configuration) else { return }
            guard let rawEnvironment = Bundle.main.object(forInfoDictionaryKey: "CalledItAPNsEnvironment") as? String,
                  ["development", "production"].contains(rawEnvironment) else { throw NativeError.configuration }
            let _: Ignored? = try await API.mutation("v0Notifications:register", [
                "token": session.token, "deviceToken": deviceToken.map { String(format: "%02x", $0) }.joined(),
                "environment": rawEnvironment == "development" ? "sandbox" : "production", "requestId": UUID().uuidString,
            ])
            status = "Registered on this device"
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func unregister() async {
        do {
            let configuration = try Config.load()
            guard let session = try SessionStore.load(configuration: configuration) else { return }
            let _: Ignored? = try await API.mutation("v0Notifications:unregister", ["token": session.token, "requestId": UUID().uuidString])
        } catch { self.error = error.localizedDescription }
    }

    func registrationFailed() {
        error = "Push registration isn't available. You can still open cards manually."
    }
}

final class ApplicationDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await HostNotifications.shared.registered(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in HostNotifications.shared.registrationFailed() }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
