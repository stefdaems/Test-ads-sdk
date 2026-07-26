# Web Host Apps

Two HTML / JavaScript host page stubs for validating the ad SDK in real browsers.

## Directory layout

```
web/
├── good/       # Correct SDK integration
└── bad/        # Intentional misuse scenarios
```

## good/ — Correct integration

The "Good" host page:
1. Loads the SDK script asynchronously (does not block page render).
2. Calls `AdSDK.init({ publisherId: 'PROD_PID', consent: tcfConsentString })` after the TCF CMP API returns.
3. Passes a valid ad container `<div id="ad-slot">` with explicit `width` and `height`.
4. Removes the ad iframe on `destroy()` to avoid layout thrash.
5. Passes the [CLS, LCP, FID] Core Web Vital budget thresholds (use Lighthouse CI to measure).

### Run locally

```bash
cd host-apps/web/good
npx serve .                     # starts a local HTTP server on port 3000
```

Open in **Chrome**, **Firefox**, and **Safari** (use a Mac for Safari).

## bad/ — Intentional misuse scenarios

Each bad scenario is a separate HTML page linked from `index.html`.

| Page | Scenario | What it tests |
|---|---|---|
| `double-init.html` | `AdSDK.init()` called twice | Must not duplicate ad requests |
| `no-consent.html` | TCF string absent | Must not fire tracking pixels |
| `null-slot.html` | Ad container not in DOM | Must throw a recoverable error |
| `sandboxed-iframe.html` | SDK loaded inside `sandbox` iframe without `allow-scripts` | Must degrade gracefully |
| `third-party-cookies-blocked.html` | `document.cookie` blocked (Safari ITP simulation) | Must fall back to cookieless flow |
| `cls-bloat.html` | Ad causes layout shift > 0.1 CLS | Must stay within CLS budget |

### Run locally

```bash
cd host-apps/web/bad
npx serve .
```

## Browser matrix

| Browser | Min version | Key concern |
|---|---|---|
| Chrome | 120 | Baseline |
| Firefox | 121 | Enhanced Tracking Protection |
| Safari | 17 | ITP third-party cookie blocking, sandboxed iframe restrictions |
| Edge | 120 | Same as Chrome |
| Samsung Internet | 24 | Android OEM browser used by many Galaxy users |

## Core Web Vitals budget

The SDK must not degrade the host page beyond these thresholds:

| Metric | Budget |
|---|---|
| LCP | ≤ 2.5 s |
| CLS | ≤ 0.1 |
| INP | ≤ 200 ms |
