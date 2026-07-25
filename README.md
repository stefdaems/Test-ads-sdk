# Test-ads-sdk

A cross-platform ad SDK shipping strategy — including dummy host apps, device-lab integration tests, and an Appium automation framework — that keeps the SDK bulletproof across iOS, Android, tvOS, and Web.

---

## Repository layout

```
Test-ads-sdk/
├── host-apps/              # Dummy host apps used as real integration harnesses
│   ├── ios/                # iOS host app (good & bad configurations)
│   ├── android/            # Android host app (good & bad configurations)
│   ├── tvos/               # tvOS host app (good & bad configurations)
│   └── web/                # Web host app (good & bad configurations)
├── tests/                  # Cross-platform Appium test suites
│   ├── consent/            # Initialization & Consent tests
│   ├── network/            # Network & Telemetry proxy tests
│   ├── viewability/        # Viewability & Rendering tests
│   └── memory/             # Memory Teardown tests
├── docs/                   # Per-platform edge-case guides
│   ├── ios-edge-cases.md
│   ├── android-edge-cases.md
│   ├── tvos-edge-cases.md
│   └── web-edge-cases.md
├── TESTING.md              # Full testing strategy overview
└── README.md               # This file
```

## Quick start

1. **Clone** this repository.
2. **Read** [TESTING.md](./TESTING.md) to understand the end-to-end testing strategy.
3. **Pick** a platform under `host-apps/` and follow its `README.md`.
4. **Run** the automated tests from `tests/` using [Appium](https://appium.io/) connected to your real-device lab.

## Key documentation

| Document | Purpose |
|---|---|
| [TESTING.md](./TESTING.md) | Master testing strategy (Host App strategy, Core Validation Loop, Platform Edge Cases, Automation) |
| [docs/ios-edge-cases.md](./docs/ios-edge-cases.md) | ATT, WKWebView, background execution limits |
| [docs/android-edge-cases.md](./docs/android-edge-cases.md) | Hardware fragmentation, OEM battery modes |
| [docs/tvos-edge-cases.md](./docs/tvos-edge-cases.md) | D-Pad navigation, focus traps |
| [docs/web-edge-cases.md](./docs/web-edge-cases.md) | iframe sandboxing, third-party cookies, Core Web Vitals |

> **Pre-release reminder:** Always ensure test Publisher IDs (PIDs) and debug modes are disabled before shipping the final binary.
