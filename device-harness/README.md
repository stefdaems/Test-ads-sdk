# Ads SDK Device Harness

An **on-device test application** plus an **external manager** that lets you drive
Ads SDK test scenarios on real devices (Samsung/Tizen, Vizio, Android TV, LG webOS,
mobile, desktop) from a central place.

Devices and the manager communicate through an **MQTT message broker** — they are
never required to hold a direct link to each other:

```
                                   ┌───────────────────────┐
  External system  ── REST ─────►  │        Manager        │
  (CI, operator, dashboard)        │  (broker client)      │
                                   └───────────┬───────────┘
                                               │ MQTT (pub/sub)
                                     ┌──────────┴──────────┐
                                     │    Message broker   │  ◄─ embedded (aedes)
                                     │  MQTT over TCP / WS │     or external MQTT_URL
                                     └──────────┬──────────┘
                                               │ MQTT (pub/sub)
                     ┌─────────────────────────┼─────────────────────────┐
              ┌──────┴──────┐            ┌──────┴──────┐            ┌──────┴──────┐
              │  Device app │            │  Device app │            │  Device app │
              │ (TV browser)│            │ (mobile)    │            │ (desktop)   │
              └─────────────┘            └─────────────┘            └─────────────┘
```

* Each **device** opens a single URL (`/app`) in its browser. It connects **out**
  to the broker (MQTT over WebSocket), announces itself with a retained status
  message + Last-Will, and subscribes to its own command topic.
* The **manager** is also just a broker client. It keeps a live overview of which
  **devices** are connected and which **apps** can be tested, dispatches commands
  by publishing to a device's topic, and collects live debug/trace events + results.
* An **external system** (or a human using the dashboard) tells the manager to run
  a scenario — or the whole suite — on a specific device over REST. The manager
  relays it through the broker, so the external system never needs a direct link
  to the device.

## Cluster deployment & the build → install → run → overview flow

The harness is deployable on a cluster. Apps are **built once into a shared
location** and devices **install** a chosen build before a run:

```
   ┌────────────┐   build    ┌────────────────────┐
   │ build Job  │ ─────────► │  Shared artifact    │   (PVC / object store,
   └────────────┘            │  store  /artifacts  │    ARTIFACTS_DIR)
                             └─────────┬───────────┘
                                       │ served at /artifacts
                              ┌────────┴─────────┐
   target device ──────────►  │     Manager      │  ◄── observe run + results
   install build             └────────┬─────────┘
                                       │ MQTT (install / run / trace / results)
                                 ┌─────┴─────┐
                                 │  Device   │  downloads + installs the build,
                                 └───────────┘  then runs scenarios on command
```

1. **Build to a shared location.** `npm run build` (or `POST /api/builds`, or the
   Kubernetes build Job) packages the on-device app into an immutable,
   content-addressed bundle `ARTIFACTS_DIR/<appId>/<buildId>/` and records it in
   the shared registry `ARTIFACTS_DIR/index.json`. On a cluster `ARTIFACTS_DIR`
   is a shared volume (PVC) so every manager replica serves the same builds.
2. **Target a device.** Pick a connected device (dashboard or `GET /api/devices`).
3. **Install onto that device.** `POST /api/devices/:id/install {buildId}` publishes
   an `install` command over the broker. The device downloads the build's manifest
   from the shared store (`/artifacts/...`), verifies its content hash and reports
   back `installed`.
4. **Start a run.** `POST /api/devices/:id/run` / `run-all`. Runs are **refused with
   `409 app_not_installed`** until a build is installed on the target device.
5. **Observe.** Follow the run live from the manager (`/api/runs/:id/debug`, or the
   dashboard "Live debug follow-up" panel).
6. **Simple overview.** `GET /api/overview` (and the dashboard "Results overview"
   panel) shows each device, its installed build and its last run's pass/fail tally.

### Deploy on Kubernetes

```bash
cd device-harness
docker build -f deploy/Dockerfile -t adsdk-device-harness:latest .   # push to your registry

kubectl apply -f deploy/k8s/00-namespace.yaml
kubectl apply -f deploy/k8s/10-artifacts-pvc.yaml        # shared build store (RWX)
kubectl apply -f deploy/k8s/20-build-job.yaml            # build app into the shared store
kubectl apply -f deploy/k8s/30-manager-deployment.yaml
kubectl apply -f deploy/k8s/40-manager-service.yaml
```

Set `PUBLIC_URL` (in the Deployment) to the address devices reach the manager on,
so install commands hand devices a downloadable build URL. To scale the manager
beyond one replica, point every replica at a shared external broker via `MQTT_URL`.

### Deploy locally with Docker Compose

```bash
cd device-harness
docker compose -f deploy/docker-compose.yml up --build
```

The `builder` service publishes a build into the shared `artifacts` volume, then
the `manager` service serves the dashboard/app/REST API + broker from it.

## Why a message broker?

A direct manager→device connection cannot be guaranteed: real TVs and mobiles sit
behind NAT, on isolated “device VLANs”, or on captive networks where inbound
connections are impossible. With a broker, **every party only makes an outbound
connection**, so devices remain reachable regardless of network topology. It also
gives natural presence detection (retained status + Last-Will), fan-out to multiple
operators, and buffering.

By default the manager starts an **embedded** broker (aedes) so the whole system
runs with a single `npm start`. To use a shared/cloud broker instead, set
`MQTT_URL` (see below) — the manager and every device then connect to that broker.

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
| `shared/topics.js` | Canonical MQTT topic scheme shared by the app and the manager. |
| `shared/builds.js` | Helpers for the shared build/artifact store (`ARTIFACTS_DIR`, build registry). |
| `scripts/build-app.js` | Builds the on-device app into the shared store as an immutable, content-addressed bundle. |
| `deploy/` | Container image, Docker Compose and Kubernetes manifests for cluster deployment. |
| `app/index.html` | The on-device test app UI. |
| `app/app.js` | Device controller: detects the device + app identity, connects to the broker, installs builds, runs commands, streams debug events + results. |
| `app/sdk-adapter.js` | Swappable SDK adapter — reference implementation by default, real SDK when present. |
| `app/scenarios.js` | Executable runner for each catalogue scenario (also runnable under Node); streams live events via an `onEvent` hook. |
| `manager/broker.js` | Embedded MQTT broker (aedes) — MQTT over TCP + MQTT over WebSocket. |
| `manager/server.js` | External manager: static serving, REST API, broker client, device/app registry, debug + result collection. |
| `manager/public/index.html` | Operator dashboard (devices, apps, runs, live debug follow-up). |
| `scripts/smoke-test.js` | End-to-end check (boots the manager + broker, connects a simulated MQTT device, drives the REST API). |

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
npm start            # HTTP on 0.0.0.0:8090, embedded MQTT broker on :1883 (+ ws:/mqtt)
```

Then:

* Operator dashboard: `http://<manager-host>:8090/`
* On-device app URL:   `http://<manager-host>:8090/app`

Open the app URL in the browser of each device you want to test. The device
connects to the broker and shows up in the dashboard within a second.

By default the app connects to the broker over MQTT-over-WebSocket at
`ws://<same-host>:8090/mqtt`. To point a device at a different broker, either pass
`?broker=ws://<broker-host>:<port>/mqtt` on the app URL or type it into the app's
on-screen field.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | HTTP port (dashboard, app, REST API, MQTT-over-WS `/mqtt`). |
| `HOST` | `0.0.0.0` | Bind address. |
| `MQTT_PORT` | `1883` | TCP port for the embedded broker (native/Node MQTT clients). |
| `MQTT_URL` | – | If set, skip the embedded broker and connect to this external broker instead (e.g. `mqtt://broker.example:1883`). |
| `ARTIFACTS_DIR` | `./artifacts` | Shared build/artifact store. Mount a shared volume (PVC) here on a cluster. |
| `PUBLIC_URL` | `http://<host>:<port>` | Externally reachable base URL devices download installed builds from. |

## Message broker topics

Prefix defaults to `adsdk` (see `shared/topics.js`):

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `adsdk/register` | device → broker | Announce presence (app + device + scenarios). |
| `adsdk/devices/<id>/status` | device → broker | Retained online/offline status (+ Last-Will), installed build. |
| `adsdk/devices/<id>/cmd` | manager → device | `install` / `run` / `run_all` commands. |
| `adsdk/devices/<id>/install` | device → broker | App install progress/result. |
| `adsdk/devices/<id>/event` | device → broker | Live debug/trace events during a run. |
| `adsdk/devices/<id>/result` | device → broker | Per-scenario result. |
| `adsdk/devices/<id>/run-complete` | device → broker | `run_all` finished. |

## Instructing a device from an external system

List connected devices and the apps under test:

```bash
curl http://<manager-host>:8090/api/devices
curl http://<manager-host>:8090/api/apps
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

Follow a run live (debug/trace) and read results:

```bash
curl http://<manager-host>:8090/api/runs/<runId>/debug   # live trace events
curl http://<manager-host>:8090/api/runs/<runId>         # status + results + debug
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
  ],
  "debug": [
    { "ts": "…", "kind": "scenario_start", "scenarioId": "preroll" },
    { "ts": "…", "kind": "sdk_event", "name": "ad_started", "scenarioId": "preroll" }
  ]
}
```

### REST API summary

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET  | `/api/health` | – | Liveness + broker info. |
| GET  | `/api/devices` | – | Connected devices + status + installed build. |
| GET  | `/api/apps` | – | Apps that can be tested and on how many devices. |
| GET  | `/api/builds` | – | App builds available in the shared store + its location. |
| POST | `/api/builds` | – | Build the app into the shared store. Returns `{ build }`. |
| GET  | `/api/scenarios` | – | Full scenario catalogue. |
| POST | `/api/devices/:deviceId/install` | `{ "buildId": "…" }` | Install a build onto the device. Returns `{ installId }`. |
| POST | `/api/devices/:deviceId/run` | `{ "scenarioId": "…" }` | Run one scenario on a device. Returns `{ runId }`. |
| POST | `/api/devices/:deviceId/run-all` | – | Run the whole suite on a device. Returns `{ runId }`. |
| GET  | `/api/overview` | – | Simple per-device results overview (installed build + last run). |
| GET  | `/api/runs` | – | Recent runs. |
| GET  | `/api/runs/:runId` | – | Run status + results + debug log. |
| GET  | `/api/runs/:runId/debug` | – | Live debug/trace log for a run. |

## Validating the harness

```bash
cd device-harness
npm run smoke
```

This boots the manager + embedded broker, connects a simulated **MQTT** device that
runs the real scenario code against the reference SDK, and drives the REST API
exactly like an external system would — asserting every scenario passes, that the
app is discovered, and that live debug follow-up is captured. It exits non-zero on
any failure, so it is CI-friendly.

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
