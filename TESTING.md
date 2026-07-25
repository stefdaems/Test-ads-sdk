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

**Recommended tool: [Appium](https://appium.io/)**

- Write unified **cross-platform test scripts** that dynamically allocate available devices from your lab.
- Automate gestures, simulate network drops on physical devices, and test video buffering recovery — without manual intervention.

See [`tests/`](./tests/) for the full set of Appium test suites.

### Running the tests

```bash
# Install Node.js dependencies (Appium client + WebdriverIO)
cd tests
npm install

# Run all tests against a locally connected device (iOS example)
PLATFORM=ios DEVICE_UDID=<your-device-udid> npm test

# Run all tests for Android
PLATFORM=android DEVICE_SERIAL=<your-device-serial> npm test

# Run only consent tests
npm test -- --spec consent/
```

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
