# Ads SDK Device Harness

An **on-device test application** plus an **external manager** that lets you drive
Ads SDK test scenarios on real devices (Samsung/Tizen, Vizio, Android TV, LG webOS,
mobile, desktop) from a central place.

```
                 REST API / dashboard                WebSocket
 External system  ───────────────►  Manager (Node)  ◄──────────►  Device app
 (CI, operator)                     server.js                     (browser on TV)
```

* The **device** opens a single URL (`/app`) in its browser. It registers itself
  with the manager over WebSocket and waits for commands.
* The **manager** keeps a live registry of connected devices, exposes a REST API,
  and serves an operator dashboard.
* An **external system** (or a human using the dashboard) tells the manager to run
  a specific scenario — or the whole suite — on a specific device. Results stream
  back and are queryable over REST.

## Why a browser app?

Smart-TV platforms (Tizen, webOS, Vizio SmartCast, Android TV) and mobile devices
all ship a browser/WebView, so a single HTML app runs everywhere without native
build tooling. The app is self-contained: it uses a **reference SDK adapter**
(`app/sdk-adapter.js`) that models the correct Ads SDK behaviour, so every scenario
is executable out of the box. `create()` in the adapter is the single integration
point for wiring in the **real** SDK: when `window.AdsSDK` is present it reports
`backend: "real"`, which is where a thin delegating wrapper is added to forward
calls to the real SDK.

## Layout

| Path | Purpose |
|------|---------|
| `shared/catalogue.js` | Single source of truth for all test scenarios (id, title, category). Loaded by both the app and the manager. |
| `app/index.html` | The on-device test app UI. |
| `app/app.js` | Device controller: detects the device, connects to the manager, runs commands, streams results. |
| `app/sdk-adapter.js` | Swappable SDK adapter — reference implementation by default, real SDK when present. |
| `app/scenarios.js` | Executable runner for each catalogue scenario (also runnable under Node). |
| `manager/server.js` | External manager: static serving, REST API, device/operator WebSockets. |
| `manager/public/index.html` | Operator dashboard. |
| `scripts/smoke-test.js` | End-to-end check (boots the manager, connects a simulated device, drives the REST API). |

## Scenario coverage

Scenarios span the SDK's use-cases (see `shared/catalogue.js` for the full list):

* **Initialization** – valid/invalid publisher id, double-init guard.
* **Consent & privacy** – GDPR/TCF, CCPA opt-out, iOS ATT, "deny consent ⇒ no tracking".
* **Ad scheduling** – pre/mid/post-roll, VMAP multi-break, ad pods.
* **Skip** – skip button offset, non-skippable enforcement.
* **VAST** – linear, wrapper, empty & 404 graceful fallback.
* **Tracking** – impression/click once, quartiles in order, no duplicates after
  network drop, HTTPS-only, consent header present.
* **Viewability** – in-viewport, click not blocked by overlay, pause on background.
* **Memory** – ad view removed on teardown, stable across 10 cycles, threads released.

## Running the manager

```bash
cd device-harness
npm install
npm start            # listens on 0.0.0.0:8090 (override with PORT / HOST)
```

Then:

* Operator dashboard: `http://<manager-host>:8090/`
* On-device app URL:   `http://<manager-host>:8090/app?manager=ws://<manager-host>:8090/ws`

Open the app URL in the browser of each device you want to test. The device shows
up in the dashboard within a second.

> The app also accepts the manager URL typed into its on-screen field, so you can
> point a device at the manager without query params.

## Instructing a device from an external system

List connected devices:

```bash
curl http://<manager-host>:8090/api/devices
```

Run a single scenario on a device:

```bash
curl -X POST http://<manager-host>:8090/api/devices/<deviceId>/run \
     -H 'Content-Type: application/json' \
     -d '{"scenarioId":"preroll"}'
# -> { "runId": "..." }
```

Run the whole suite on a device:

```bash
curl -X POST http://<manager-host>:8090/api/devices/<deviceId>/run-all
```

Poll for results:

```bash
curl http://<manager-host>:8090/api/runs/<runId>
```

A completed run looks like:

```json
{
  "runId": "…",
  "deviceId": "…",
  "type": "single",
  "status": "completed",
  "results": [
    {
      "id": "preroll",
      "status": "passed",
      "durationMs": 122,
      "assertions": [{ "name": "impression fired once", "ok": true }],
      "events": ["ad_break_started", "ad_started", "…"]
    }
  ]
}
```

### REST API summary

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET  | `/api/health` | – | Liveness. |
| GET  | `/api/devices` | – | Connected devices + status. |
| GET  | `/api/scenarios` | – | Full scenario catalogue. |
| POST | `/api/devices/:deviceId/run` | `{ "scenarioId": "…" }` | Run one scenario on a device. Returns `{ runId }`. |
| POST | `/api/devices/:deviceId/run-all` | – | Run the whole suite on a device. Returns `{ runId }`. |
| GET  | `/api/runs` | – | Recent runs. |
| GET  | `/api/runs/:runId` | – | Run status + results. |

## Validating the harness

```bash
cd device-harness
npm run smoke
```

This boots the manager, connects a simulated device that runs the real scenario
code against the reference SDK, and drives the REST API exactly like an external
system would, asserting every scenario passes. It exits non-zero on any failure,
so it is CI-friendly.

## Plugging in the real Ads SDK

1. Host the real SDK build alongside the app (or reference it by URL).
2. Add its `<script>` to `app/index.html` **before** `sdk-adapter.js`.
3. Ensure it exposes a global (default expected name: `window.AdsSDK`) whose surface
   matches the adapter's contract (`init`, `setConsent`, `loadAd(opts, cb)`, `click`,
   `skip`, `setNetwork`, `setHidden`, `destroy`, plus event emission via `on`).
4. In `create()` (`app/sdk-adapter.js`), the `backend: "real"` branch is where a
   thin wrapper delegates the contract methods to `window.AdsSDK` and bridges its
   events onto `_emit`. Once wired, every scenario exercises the real SDK; until
   then the reference implementation runs as the executable spec.
