# Ad SDK Testing Strategy

Shipping an ad SDK is uniquely high-stakes. If an app developer introduces a bug, their app crashes; if your SDK introduces a bug, you crash your **customers'** apps, potentially costing them revenue and ruining your reputation.

Since you already have a lab of real devices, you are in a great position. Emulators are fine for early UI checks, but **real devices are mandatory** for testing real-world hardware behavior, memory constraints, and network drops.

---

## 1. The "Host App" Strategy

You cannot test an SDK in isolation. You need to build **Dummy Host Apps** (one for iOS, Android, tvOS, and Web) that mimic how a customer will actually implement your code.

| Host type | Purpose |
|---|---|
| **The "Good" Host** | Implements your SDK perfectly according to your documentation. |
| **The "Bad" Host** | Intentionally misconfigures the SDK (e.g., calls initialization twice, passes `null` values, blocks the main thread) to ensure your SDK **fails gracefully** without taking down the host app. |

Skeleton host apps live under [`host-apps/`](./host-apps/). Each sub-directory contains:
- `good/` — correct integration
- `bad/` — intentional misuse scenarios
- `README.md` — how to build and run on real devices

---

## 2. The Core Validation Loop

For every release candidate, your testing on real devices must follow a strict lifecycle flow. **Order matters**, because ad rendering and tracking are highly sequential.

### 2.1 Initialization & Consent — Privacy first

Before requesting any ads, ensure the SDK correctly reads user consent signals.

- **iOS**: Test App Tracking Transparency (ATT) enforcement.
- **Global**: Test GDPR / CCPA / TCF string parsing.
- **Verification**: When consent is denied, verify that the SDK **drops the tracking payloads** and does not fire any impression or click pixels.

Automated tests: [`tests/consent/`](./tests/consent/)

### 2.2 Network & Telemetry — Use a proxy

Connect your real devices to a network proxy (e.g., Charles Proxy or Wireshark). Verify:

- Tracking pixels (impressions, clicks, video quartiles) fire **exactly once** at the correct time.
- Network drops do **not** cause duplicate pings upon reconnection.
- All requests use HTTPS and carry correct headers (consent signals, SDK version, etc.).

Automated tests: [`tests/network/`](./tests/network/)

### 2.3 Viewability & Rendering — UI constraints

Ensure ads are fully visible and clickable, and that no host app elements (even transparent ones) obscure the player.

- Test how the SDK behaves when the host app goes to the **background mid-video playback**.
- Verify that the ad pauses/resumes correctly and does not fire false completion events.
- Test across different device orientations and screen densities.

Automated tests: [`tests/viewability/`](./tests/viewability/)

### 2.4 Memory Teardown — Prevent leaks

Publishers will drop your SDK if it bloats their app.

- Test the **destruction of the ad**: ensure the ad view is removed from its superview / parent between each ad load.
- Verify that **all background threads are killed** when the ad is closed.
- Use platform profiling tools (Instruments on iOS, Android Studio Profiler) to confirm that no memory is retained after teardown.

Automated tests: [`tests/memory/`](./tests/memory/)

---

## 3. Platform-Specific Edge Cases

"Write once, run everywhere" rarely applies to deep SDK integrations. Target your real device testing to the quirks of each platform.

| Platform | Critical Testing Focus |
|---|---|
| **iOS** | App Tracking Transparency (ATT) enforcement, strict background execution limits, and WKWebView lifecycle handling for rich media ads. |
| **Android** | Hardware fragmentation. Test across different OS versions, OEM battery-saving modes (which aggressively kill background SDK tasks), and varying screen densities. |
| **CTV / tvOS** | No touch events. Navigation relies entirely on simulated key events (D-Pad up/down/left/right). Test for **focus traps** where a user gets "stuck" inside an ad and cannot navigate back to the host app. |
| **Web** | Cross-browser compatibility, strict iframe sandboxing rules, third-party cookie blocking (Safari / Firefox), and impact on the host site's Core Web Vitals. |

Per-platform detailed guides:
- [docs/ios-edge-cases.md](./docs/ios-edge-cases.md)
- [docs/android-edge-cases.md](./docs/android-edge-cases.md)
- [docs/tvos-edge-cases.md](./docs/tvos-edge-cases.md)
- [docs/web-edge-cases.md](./docs/web-edge-cases.md)

---

## 4. Automating Your Device Lab

Manual testing on real devices will eventually become a bottleneck. To scale, connect your physical devices to an automation framework.

**Test stack: [Appium](https://appium.io/) + [WebdriverIO](https://webdriver.io/) + [Jest](https://jestjs.io/) + TypeScript**

- All test specs are written in **TypeScript** and executed by **Jest** (`ts-jest`).
- WebdriverIO is used as the Appium client library.
- Run suites from the repository root or from the `tests/` directory.

See [`tests/`](./tests/) for the full set of test suites.

### Installing host apps from a centralised location

A root-level installer lets you build and deploy every host app from a single command, without having to navigate into each platform directory:

```bash
# From the repository root — install Node.js dependencies first:
npm install

# Deploy all host apps (good + bad) to connected devices:
npm run install:all

# Deploy only the iOS good app:
npm run install:ios -- --variant good

# Deploy only the Android bad app:
npm run install:android -- --variant bad

# Deploy a specific platform using the installer script directly:
ts-node scripts/install-apps.ts --platform tvos --variant all
```

Key environment variables for the installer:

| Variable | Purpose |
|---|---|
| `DEVICE_UDID` | iOS / tvOS physical device UDID (from `xcrun xctrace list devices`) |
| `DEVICE_SERIAL` | Android device serial (from `adb devices`) |
| `ANDROID_VARIANT` | `debug` (default) or `release` |
| `IOS_TEAM_ID` | Apple development team ID for code signing |

### Running the tests

```bash
# Install test dependencies
cd tests && npm install

# Run all tests against a locally connected Android device
PLATFORM=android DEVICE_SERIAL=<serial> APP_PATH=/path/to/app.apk npm test

# Run all tests for iOS
PLATFORM=ios DEVICE_UDID=<udid> APP_PATH=/path/to/app.ipa npm test

# Run only consent tests
npm run test:consent

# Run only memory teardown tests
npm run test:memory
```

### Running tests on BrowserStack App Automate

[BrowserStack App Automate](https://www.browserstack.com/app-automate) lets you run the same Appium test suite against a large fleet of real iOS and Android devices in the cloud. tvOS is **not** supported by BrowserStack App Automate.

#### Step 1 — Upload the app

```bash
# Upload an Android APK
ts-node scripts/install-apps.ts --platform android --remote browserstack

# Upload an iOS IPA
ts-node scripts/install-apps.ts --platform ios --remote browserstack
```

The script prints a `bs://…` URL on success:

```
✅ BrowserStack app URL: bs://abc123...
   Set BROWSERSTACK_APP_URL=bs://abc123... when running tests
```

#### Step 2 — Run the tests

```bash
cd tests && npm install

# Android example
BROWSERSTACK_USERNAME=<username> \
BROWSERSTACK_ACCESS_KEY=<access-key> \
BROWSERSTACK_APP_URL=bs://<hash> \
BROWSERSTACK_DEVICE="Samsung Galaxy S22" \
BROWSERSTACK_OS_VERSION="12.0" \
PLATFORM=android \
npm test

# iOS example
BROWSERSTACK_USERNAME=<username> \
BROWSERSTACK_ACCESS_KEY=<access-key> \
BROWSERSTACK_APP_URL=bs://<hash> \
BROWSERSTACK_DEVICE="iPhone 14" \
BROWSERSTACK_OS_VERSION="16" \
PLATFORM=ios \
npm test
```

#### BrowserStack environment variables

| Variable | Required | Purpose |
|---|---|---|
| `BROWSERSTACK_USERNAME` | ✅ | BrowserStack account username |
| `BROWSERSTACK_ACCESS_KEY` | ✅ | BrowserStack access key |
| `BROWSERSTACK_APP_URL` | ✅ | `bs://…` URL returned by the upload step |
| `BROWSERSTACK_DEVICE` | recommended | Target device name (e.g. `"Samsung Galaxy S22"`) |
| `BROWSERSTACK_OS_VERSION` | recommended | Target OS version (e.g. `"12.0"`) |
| `BROWSERSTACK_BUILD_NAME` | optional | Label shown in the BrowserStack dashboard |
| `BROWSERSTACK_SESSION_NAME` | optional | Per-session label in the BrowserStack dashboard |

---

## 5. Pre-Release Checklist

Before shipping any release binary to customers, verify each item below:

- [ ] All test Publisher IDs (PIDs) and debug flags are **disabled** or swapped for production IDs.
- [ ] The "Bad" host app tests all pass (SDK handles misuse gracefully).
- [ ] Tracking pixels verified with a proxy (no duplicates, no missing fires).
- [ ] Memory profiler shows **no leaks** after ad teardown on each platform.
- [ ] CTV/tvOS focus-trap tests pass (user can always navigate out of an ad).
- [ ] Core Web Vitals impact measured on a production-like Web host page.
- [ ] All consent / ATT paths tested on a real device (not just simulator).

---

## 5. Multi-Player Integration — Feature Scope

The Ads SDK must integrate seamlessly with every major video player in the
ecosystem.  The table below shows the **full feature scope** validated per
player and per platform.

### Player matrix

| Player | Web | Android | iOS / tvOS |
|---|---|---|---|
| **THEOplayer** | ✅ | ✅ | ✅ |
| **Shaka Player** | ✅ | ✅ (via ExoPlayer ext.) | — |
| **Video.js** | ✅ | — | — |
| **ExoPlayer** | — | ✅ | — |
| **Bitmovin** | ✅ | ✅ | ✅ |

### Feature scope (every cell in the matrix must pass)

| Feature | THEOplayer | Shaka | Video.js | ExoPlayer | Bitmovin |
|---|---|---|---|---|---|
| SDK init with valid PID | All | All | Web | Android | All |
| Player adapter attaches | All | All | Web | Android | All |
| SDK rejects null PID | All | All | Web | Android | All |
| Double-init warning, no crash | All | All | Web | Android | All |
| **Pre-roll** before content | All | All | Web | Android | All |
| **Mid-roll** at time offset | All | All | Web | Android | All |
| **Post-roll** after content | All | All | Web | Android | All |
| **VMAP** multi-break scheduling | All | All | Web | Android | All |
| **Ad pod** sequential playback | All | All | Web | Android | All |
| Skip button at declared offset | All | All | Web | Android | All |
| Skip pixel on skip | All | All | Web | Android | All |
| Non-skippable — no skip button | All | All | Web | Android | All |
| VAST linear plays to completion | All | All | Web | Android | All |
| VAST non-linear overlay | All | All | Web | — | All |
| VAST companion renders | Web | Web | Web | — | Web |
| VAST wrapper chain resolves | All | All | Web | Android | All |
| Empty VAST — graceful fallback | All | All | Web | Android | All |
| 404 VAST URL — graceful fallback | All | All | Web | Android | All |
| Impression pixel fires once | All | All | Web | Android | All |
| Click pixel fires once | All | All | Web | Android | All |
| Quartile pixels (start→complete) | All | All | Web | Android | All |
| No duplicates after network drop | All | All | Web | Android | All |
| All SDK requests use HTTPS | All | All | Web | Android | All |
| x-consent-string on every request | All | All | Web | Android | All |
| Content pauses for pre-roll | All | All | Web | Android | All |
| Content resumes after ad | All | All | Web | Android | All |
| Seeking disabled during ad | All | All | Web | Android | All |
| Player controls hidden during ad | All | All | Web | Android | All |
| Full lifecycle event sequence | All | All | Web | Android | All |
| GDPR/TCF consent passed | All | All | Web | Android | All |
| No tracking on GDPR denied | All | All | Web | Android | All |
| CCPA opt-out suppresses tracking | All | All | Web | Android | All |
| ATT prompt before first ad (iOS) | THEOplayer | — | — | — | Bitmovin |
| Ad container visible in viewport | All | All | Web | Android | All |
| No overlay blocking click target | All | All | Web | Android | All |
| Ad pauses on background/hidden | All | All | Web | Android | All |
| Ad view removed after complete | All | All | Web | Android | All |
| Memory stable across 10 cycles | All | All | Web | Android | All |
| Background threads released | — | — | — | Android | All native |

### Test file locations

```
tests/
├── players/
│   ├── theoplayer/
│   │   ├── theoplayer-web.spec.ts      # Playwright / Chromium
│   │   ├── theoplayer-android.spec.ts  # Appium / Android
│   │   └── theoplayer-ios.spec.ts      # Appium / iOS + tvOS
│   ├── shaka/
│   │   ├── shaka-web.spec.ts           # Playwright / Chromium
│   │   └── shaka-android.spec.ts       # Appium / Android
│   ├── videojs/
│   │   └── videojs-web.spec.ts         # Playwright / Chromium
│   ├── exoplayer/
│   │   └── exoplayer-android.spec.ts   # Appium / Android
│   └── bitmovin/
│       ├── bitmovin-web.spec.ts         # Playwright / Chromium
│       ├── bitmovin-android.spec.ts     # Appium / Android
│       └── bitmovin-ios.spec.ts         # Appium / iOS
└── helpers/
    ├── adFeatures.ts    # Feature matrix, VAST fixtures, ad event constants
    ├── har.ts           # HAR reading & assertion utilities
    ├── webPlayer.ts     # Playwright browser helper for web player tests
    └── driver.ts        # WebdriverIO / Appium session factory
```

### Host app pages

```
host-apps/web/players/
├── theoplayer/
│   ├── index.html        # Good integration
│   ├── good/index.html   # Same (copy)
│   └── bad/index.html    # Null publisher ID
├── shaka/
│   ├── index.html / good/ / bad/
├── videojs/
│   ├── index.html / good/ / bad/
└── bitmovin/
    ├── index.html / good/ / bad/
```

### Running player tests

```bash
cd tests
npm install
npm run playwright:install   # install Playwright Chromium once

# --- Web player tests (all four players in Chromium) ---
# Start each player's host server first:
cd ../host-apps/web/players/theoplayer && npx serve . --listen 3000 &
cd ../shaka  && npx serve . --listen 3001 &
cd ../videojs  && npx serve . --listen 3002 &
cd ../bitmovin && npx serve . --listen 3003 &

cd ../../../../tests
PLAYER_HOST=http://localhost:3000 npm run test:theoplayer   # THEOplayer web
PLAYER_HOST=http://localhost:3001 npm run test:shaka        # Shaka web
PLAYER_HOST=http://localhost:3002 npm run test:videojs      # Video.js web
PLAYER_HOST=http://localhost:3003 npm run test:bitmovin     # Bitmovin web

# --- All web player tests ---
npm run test:web-players

# --- Native player tests (Android) ---
PLATFORM=android DEVICE_SERIAL=<serial> APP_PATH=/path/ExoPlayer.apk npm run test:exoplayer

# --- THEOplayer on all platforms ---
PLATFORM=ios     DEVICE_UDID=<udid>   APP_PATH=/path/theo.ipa npm run test:theoplayer
PLATFORM=android DEVICE_SERIAL=<ser>  APP_PATH=/path/theo.apk npm run test:theoplayer
```
