# Android Host Apps

Two Android Studio project stubs for validating the ad SDK across the Android device ecosystem.

## Directory layout

```
android/
├── good/       # Correct SDK integration
└── bad/        # Intentional misuse scenarios
```

## good/ — Correct integration

The "Good" host app:
1. Initialises the SDK in `Application.onCreate()` using a valid Production PID.
2. Reads the GDPR/CCPA TCF v2 string from `SharedPreferences` before any ad request.
3. Removes the ad `View` from its `ViewGroup` in `onDestroyView()` to prevent leaks.
4. Registers a `ComponentCallbacks2.onTrimMemory()` listener and frees ad resources when memory is low.
5. Handles `onPause()` / `onResume()` to pause and resume video playback correctly.

### Build & run

```bash
cd host-apps/android/good
./gradlew installDebug          # deploys to first connected device
```

### Build variants

| Variant | Purpose |
|---|---|
| `debug` | Development; debug logging enabled |
| `release` | Release; ProGuard enabled — use to confirm SDK is not stripped |

## bad/ — Intentional misuse scenarios

Toggle scenarios via the in-app Developer Options menu.

| Scenario | What it tests |
|---|---|
| Double-init | `AdSDK.initialize()` called in both `Application` and `Activity` |
| Null context | `AdSDK.initialize(null, pid)` — must not NullPointerException |
| Doze mode simulation | Device put into Doze via ADB during ad playback |
| OEM battery saver | Background tasks killed by aggressive OEM scheduler |
| Rapid config change | Device rotated rapidly during ad playback |
| Missing permissions | `INTERNET` permission removed — SDK must fail gracefully |

### Build & run

```bash
cd host-apps/android/bad
./gradlew installDebug
adb shell dumpsys deviceidle force-idle   # simulate Doze for Doze tests
```

## Device matrix

Test on at least **three** physical Android devices covering:
- Android 10, 12, and 14+
- A Samsung device (One UI battery optimisation)
- A Pixel device (stock Android baseline)
- One device with a high screen density (e.g., QHD+)
