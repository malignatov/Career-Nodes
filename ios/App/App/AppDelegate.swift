import UIKit
import WebKit
import Capacitor

/// Hides WKWebView's default input-accessory bar (the ^ ∨ ✓ strip above the
/// keyboard): the app's chat composer is the only input, so the bar is noise.
/// Standard runtime-subclass technique — the WKContent view's class is swapped
/// for a dynamic subclass whose `inputAccessoryView` returns nil.
final class BraidBridgeViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView = self.webView,
              let target = webView.scrollView.subviews.first(where: {
                  String(describing: type(of: $0)).hasPrefix("WKContent")
              }) else { return }
        let name = "NoInputAccessory_\(String(describing: type(of: target)))"
        var cls: AnyClass? = NSClassFromString(name)
        if cls == nil,
           let original = object_getClass(target),
           let method = class_getInstanceMethod(UIView.self, #selector(getter: UIResponder.inputAccessoryView)) {
            cls = objc_allocateClassPair(original, name, 0)
            if let cls = cls {
                let imp = imp_implementationWithBlock({ (_: Any) -> UIView? in nil } as @convention(block) (Any) -> UIView?)
                class_addMethod(cls, #selector(getter: UIResponder.inputAccessoryView), imp, method_getTypeEncoding(method))
                objc_registerClassPair(cls)
            }
        }
        if let cls = cls { object_setClass(target, cls) }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Storyboard-free bootstrap: the app is a single Capacitor WebView, so
        // the window is built in code (also sidesteps ibtool on beta toolchains).
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = BraidBridgeViewController()
        window?.makeKeyAndVisible()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
