# iOS Host Apps

Two Xcode project stubs for validating the ad SDK on iOS / iPadOS real devices.

## Directory layout

```
ios/
├── good/       # Correct SDK integration (follow the documentation)
└── bad/        # Intentional misuse scenarios
```

## good/ — Correct integration

The "Good" host app:
1. Requests ATT permission **before** initialising the SDK.
2. Passes a valid Publisher ID obtained from the production dashboard.
3. Calls `AdSDK.initialize()` exactly **once** in `AppDelegate.application(_:didFinishLaunchingWithOptions:)`.
4. Destroys the ad view by removing it from its superview when the user navigates away.
5. Observes `UIApplicationDidEnterBackgroundNotification` and pauses video playback.

### Build & run

```bash
cd host-apps/ios/good
open GoodHostApp.xcodeproj        # or .xcworkspace if using CocoaPods
```

Select a **physical device** (not Simulator) in Xcode and run (`⌘R`).

## bad/ — Intentional misuse scenarios

Each scenario is implemented as a separate flag in `BadHostApp` that can be toggled from Settings.

| Scenario | What it tests |
|---|---|
| Double-init | SDK called twice — must not crash or duplicate requests |
| Nil publisher ID | `AdSDK.initialize(publisherId: nil)` — SDK must reject gracefully |
| Main-thread block | Host app freezes the main thread after ad load — SDK must not deadlock |
| No ATT request | ATT dialog never shown — SDK must fall back to non-tracking mode |
| Rapid ad reload | `loadAd()` called in a tight loop — SDK must not leak memory |
| Background init | SDK initialised in a background thread — must handle or fail gracefully |

### Build & run

```bash
cd host-apps/ios/bad
open BadHostApp.xcodeproj
```

Use the in-app Settings panel to toggle individual bad scenarios.

## Device requirements

- Minimum deployment target: **iOS 14** (covers ~97 % of active devices).
- Test on at least one **iPhone** and one **iPad**.
- Connect via USB; disable Wi-Fi for network-drop tests.
