/**
 * server.js — External Manager for the on-device Ads SDK test app.
 *
 * The manager does NOT hold a direct connection to each device. Instead both the
 * manager and every device are clients of an MQTT **message broker** (see
 * broker.js). This works even when a direct manager->device link is impossible
 * (devices behind NAT / on isolated TV networks): everyone only needs an
 * outbound connection to the broker.
 *
 * Responsibilities:
 *   1. Serve the on-device test app (device-harness/app) + shared modules so a
 *      device can simply open a URL to become a broker-connected test node.
 *   2. Serve the operator dashboard (device-harness/manager/public).
 *   3. Run (or connect to) the MQTT broker, keeping a live overview of:
 *        - which devices are connected, and
 *        - which apps can be tested on them.
 *   4. Dispatch scenario-run commands to a device by publishing to its topic.
 *   5. Collect live debug/trace events + results so an external system (or the
 *      dashboard) can follow a run in progress and read results afterwards.
 *
 * REST API (external control plane — decoupled from the devices via the broker)
 *   GET  /api/health
 *   GET  /api/devices                      -> connected devices + status + installed build
 *   GET  /api/apps                         -> apps that can be tested
 *   GET  /api/builds                       -> app builds available in the shared store
 *   POST /api/builds                       -> build the app into the shared store
 *   GET  /api/scenarios                    -> scenario catalogue
 *   POST /api/devices/:deviceId/install    {buildId}     -> { installId }
 *   POST /api/devices/:deviceId/run        {scenarioId}  -> { runId }
 *   POST /api/devices/:deviceId/run-all                  -> { runId }
 *   GET  /api/runs                         -> recent runs
 *   GET  /api/runs/:runId                  -> run status + results + debug log
 *   GET  /api/runs/:runId/debug            -> live debug/trace log for a run
 *   GET  /api/overview                     -> simple per-device results overview
 *
 * Built app bundles live in a SHARED location (ARTIFACTS_DIR, a PVC on a
 * cluster). The manager serves them at /artifacts/* so a targeted device can
 * download and install a specific build before a run.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const mqtt = require('mqtt');
const { WebSocketServer } = require('ws');

const Catalogue = require('../shared/catalogue.js');
const Topics = require('../shared/topics.js');
const Builds = require('../shared/builds.js');
const { startEmbeddedBroker } = require('./broker.js');
const Cloud = require('./cloud.js');

const PORT = parseInt(process.env.PORT || '8090', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883', 10);
const MQTT_URL = process.env.MQTT_URL || '';
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = Builds.artifactsDir();
const MAX_DEBUG_PER_RUN = 2000;

// Absolute base URL a device uses to download builds from the shared store.
// On a cluster set PUBLIC_URL to the manager's externally reachable address.
function publicBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  return 'http://' + host + ':' + PORT;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
/** deviceId -> { device, app, scenarios, status, connectedAt, lastSeen } */
const devices = new Map();
/** appId -> { id, name, version, sdk, scenarioCount, devices:Set } */
const apps = new Map();
/** runId -> run */
const runs = new Map();
const operators = new Set();

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

function deviceSummary(entry) {
  return {
    id: entry.device.id,
    platform: entry.device.platform,
    make: entry.device.make,
    model: entry.device.model,
    screen: entry.device.screen,
    userAgent: entry.device.userAgent,
    app: entry.app || null,
    status: entry.status,
    installedBuild: entry.installedBuild || null,
    installStatus: entry.installStatus || (entry.installedBuild ? 'installed' : 'not_installed'),
    targetBuild: entry.targetBuild || null,
    connectedAt: entry.connectedAt,
    lastSeen: entry.lastSeen,
    scenarioCount: (entry.scenarios || []).length,
  };
}

function appSummary(entry) {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    sdk: entry.sdk,
    scenarioCount: entry.scenarioCount,
    deviceCount: entry.devices.size,
    devices: Array.from(entry.devices),
  };
}

function broadcastOperators(msg) {
  const data = JSON.stringify(msg);
  for (const op of operators) {
    if (op.readyState === 1) op.send(data);
  }
}

function registerApp(app, deviceId) {
  if (!app || !app.id) return;
  let entry = apps.get(app.id);
  if (!entry) {
    entry = { id: app.id, name: app.name || app.id, version: app.version || '', sdk: app.sdk || '', scenarioCount: app.scenarioCount || 0, devices: new Set() };
    apps.set(app.id, entry);
  } else {
    entry.name = app.name || entry.name;
    entry.version = app.version || entry.version;
    entry.sdk = app.sdk || entry.sdk;
    if (app.scenarioCount) entry.scenarioCount = app.scenarioCount;
  }
  entry.devices.add(deviceId);
}

function forgetDeviceFromApps(deviceId) {
  for (const entry of apps.values()) entry.devices.delete(deviceId);
}

// ---------------------------------------------------------------------------
// Broker (MQTT) client — the manager's link to devices
// ---------------------------------------------------------------------------
let mqttClient = null;

function upsertDeviceFromStatus(deviceId, payload) {
  if (payload && payload.status === 'offline') {
    const entry = devices.get(deviceId);
    if (entry) {
      entry.status = 'offline';
      entry.lastSeen = now();
      forgetDeviceFromApps(deviceId);
      broadcastOperators({ type: 'device_disconnected', deviceId });
    }
    return;
  }
  if (!payload || !payload.device || !payload.device.id) return;
  const existed = devices.has(deviceId);
  const entry = devices.get(deviceId) || { connectedAt: now() };
  entry.device = payload.device;
  entry.app = payload.app || null;
  entry.scenarios = payload.scenarios || [];
  entry.status = entry.status === 'running' ? 'running' : 'idle';
  if (payload.installedBuild !== undefined) entry.installedBuild = payload.installedBuild;
  if (payload.installStatus) entry.installStatus = payload.installStatus;
  entry.lastSeen = now();
  devices.set(deviceId, entry);
  registerApp(payload.app, deviceId);
  broadcastOperators({
    type: existed ? 'device_updated' : 'device_connected',
    device: deviceSummary(entry),
  });
}

function recordDebug(runId, deviceId, ev) {
  const run = runs.get(runId);
  if (!run) return;
  const entry = Object.assign({ ts: now(), deviceId }, ev);
  run.debug.push(entry);
  if (run.debug.length > MAX_DEBUG_PER_RUN) run.debug.shift();
  broadcastOperators({ type: 'debug', runId, deviceId, event: entry });
}

function recordResult(runId, deviceId, result) {
  const run = runs.get(runId);
  const entry = devices.get(deviceId);
  if (run) {
    run.results.push(result);
    run.status = run.type === 'single' ? 'completed' : 'running';
  }
  if (entry) entry.status = 'idle';
  broadcastOperators({ type: 'result', runId, deviceId, result });
}

function recordInstall(deviceId, payload) {
  const entry = devices.get(deviceId);
  if (!entry) return;
  entry.installStatus = payload.status || 'installed';
  if (payload.status === 'installed') {
    entry.installedBuild = payload.buildId || entry.targetBuild || null;
  }
  entry.installError = payload.error || null;
  entry.lastSeen = now();
  broadcastOperators({
    type: 'install',
    deviceId,
    buildId: payload.buildId || entry.targetBuild || null,
    status: entry.installStatus,
    error: entry.installError,
  });
}

function completeRun(runId, deviceId, results) {  const run = runs.get(runId);
  const entry = devices.get(deviceId);
  if (run) {
    run.status = 'completed';
    if (Array.isArray(results) && results.length) run.results = results;
  }
  if (entry) entry.status = 'idle';
  broadcastOperators({ type: 'run_all_complete', runId, deviceId, results });
}

function onBrokerMessage(topic, buf) {
  let payload;
  try { payload = JSON.parse(buf.toString()); } catch (e) { return; }

  if (topic === Topics.register) {
    if (payload.device && payload.device.id) upsertDeviceFromStatus(payload.device.id, payload);
    return;
  }
  const deviceId = Topics.deviceIdOf(topic);
  if (!deviceId) return;

  if (topic === Topics.status(deviceId)) {
    upsertDeviceFromStatus(deviceId, payload);
  } else if (topic === Topics.install(deviceId)) {
    recordInstall(deviceId, payload);
  } else if (topic === Topics.event(deviceId)) {
    recordDebug(payload.runId, deviceId, payload);
  } else if (topic === Topics.result(deviceId)) {
    recordResult(payload.runId, deviceId, payload.result);
  } else if (topic === Topics.runComplete(deviceId)) {
    completeRun(payload.runId, deviceId, payload.results);
  }
}

function connectBroker(url) {
  const client = mqtt.connect(url, { clientId: 'adsdk-manager-' + uuid().slice(0, 8), clean: true });
  client.on('connect', () => {
    client.subscribe(Topics.subscriptions, () => {});
    /* eslint-disable no-console */
    console.log('Manager connected to MQTT broker at ' + url);
  });
  client.on('message', onBrokerMessage);
  client.on('error', (e) => { console.error('MQTT client error:', e.message); });
  return client;
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Serve the mqtt.js browser bundle so devices can speak MQTT-over-WebSocket
// without any build step. Resolve via the package root because the package's
// `exports` map does not expose the dist bundle as a subpath.
const MQTT_BUNDLE = path.join(path.dirname(require.resolve('mqtt/package.json')), 'dist', 'mqtt.min.js');

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/manager/public/index.html';
  else if (rel === '/app' || rel === '/app/') rel = '/app/index.html';

  const isArtifact = rel.startsWith('/artifacts/');
  let filePath;
  if (rel === '/vendor/mqtt.min.js') {
    filePath = MQTT_BUNDLE;
  } else if (isArtifact) {
    // Built app bundles are served from the SHARED store (may live outside ROOT).
    filePath = path.normalize(path.join(ARTIFACTS_DIR, rel.slice('/artifacts/'.length)));
    if (!filePath.startsWith(ARTIFACTS_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  } else {
    filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const headers = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' };
    // Devices may load the app from a different origin than the manager that
    // serves the shared builds, so allow cross-origin download of artifacts.
    if (isArtifact) headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(200, headers);
    res.end(buf);
  });
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------
function json(res, code, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
  });
}

function dispatchInstall(deviceId, buildId) {
  const entry = devices.get(deviceId);
  if (!entry || entry.status === 'offline') return { error: 'device_not_connected', code: 404 };
  const build = Builds.getBuild(buildId);
  if (!build) return { error: 'unknown_build', code: 400 };

  const installId = uuid();
  entry.targetBuild = buildId;
  entry.installStatus = 'installing';
  entry.installError = null;

  const base = publicBaseUrl();
  const cmd = {
    type: 'install',
    installId,
    build: {
      buildId: build.buildId,
      appId: build.appId,
      version: build.version,
      hash: build.hash,
      manifestUrl: base + build.manifestUrl,
      entryUrl: base + build.entryUrl,
    },
  };
  if (mqttClient) mqttClient.publish(Topics.cmd(deviceId), JSON.stringify(cmd), { qos: 1 });

  broadcastOperators({ type: 'install', deviceId, buildId, status: 'installing' });
  return { installId, buildId };
}

function dispatchRun(deviceId, scenarioId, all) {
  const entry = devices.get(deviceId);
  if (!entry || entry.status === 'offline') return { error: 'device_not_connected', code: 404 };
  if (!entry.installedBuild) return { error: 'app_not_installed', code: 409 };
  if (!all && !Catalogue.byId(scenarioId)) return { error: 'unknown_scenario', code: 400 };

  const runId = uuid();
  const run = {
    runId,
    deviceId,
    buildId: entry.installedBuild || null,
    scenarioId: all ? null : scenarioId,
    type: all ? 'all' : 'single',
    status: 'dispatched',
    createdAt: now(),
    results: [],
    debug: [],
  };
  runs.set(runId, run);
  entry.status = 'running';

  const cmd = all
    ? { type: 'run_all', runId }
    : { type: 'run', runId, scenarioId };
  if (mqttClient) mqttClient.publish(Topics.cmd(deviceId), JSON.stringify(cmd), { qos: 1 });

  broadcastOperators({ type: 'run_created', run });
  return { runId };
}

// ---------------------------------------------------------------------------
// Build (into the shared store) + results overview
// ---------------------------------------------------------------------------
function buildApp(version, cb) {
  const args = [path.join(ROOT, 'scripts', 'build-app.js')];
  if (version) args.push('--version', String(version));
  execFile(process.execPath, args, { env: process.env }, (err) => {
    if (err) return cb(err);
    // The newest build in the shared registry is the one we just wrote.
    const build = Builds.listBuilds()[0] || null;
    broadcastOperators({ type: 'build', build });
    cb(null, build);
  });
}

function runSummary(run) {
  const total = run.results.length;
  const passed = run.results.filter((r) => r.status === 'passed').length;
  return {
    runId: run.runId,
    type: run.type,
    scenarioId: run.scenarioId,
    status: run.status,
    buildId: run.buildId || null,
    passed,
    failed: total - passed,
    total,
    at: run.createdAt,
  };
}

function overview() {
  const runList = Array.from(runs.values());
  const perDevice = Array.from(devices.values()).map((entry) => {
    const id = entry.device && entry.device.id;
    const lastRun = runList.filter((r) => r.deviceId === id).slice(-1)[0];
    return {
      id,
      platform: entry.device && entry.device.platform,
      model: entry.device && entry.device.model,
      status: entry.status,
      installedBuild: entry.installedBuild || null,
      installStatus: entry.installStatus || (entry.installedBuild ? 'installed' : 'not_installed'),
      lastRun: lastRun ? runSummary(lastRun) : null,
    };
  });
  const totals = runList.reduce((acc, r) => {
    acc.passed += r.results.filter((x) => x.status === 'passed').length;
    acc.failed += r.results.filter((x) => x.status !== 'passed').length;
    return acc;
  }, { passed: 0, failed: 0 });
  return {
    devices: perDevice.length,
    installed: perDevice.filter((d) => d.installedBuild).length,
    runs: runList.length,
    passed: totals.passed,
    failed: totals.failed,
    perDevice,
    recentRuns: runList.slice(-20).reverse().map(runSummary),
  };
}

// ---------------------------------------------------------------------------
// HTTP router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/api/')) {
    if (req.method === 'GET' && url === '/api/health') {
      return json(res, 200, { ok: true, devices: devices.size, apps: apps.size, runs: runs.size, broker: MQTT_URL || ('embedded:' + MQTT_PORT) });
    }
    if (req.method === 'GET' && url === '/api/devices') {
      return json(res, 200, { devices: Array.from(devices.values()).map(deviceSummary) });
    }
    if (req.method === 'GET' && url === '/api/apps') {
      return json(res, 200, { apps: Array.from(apps.values()).map(appSummary) });
    }
    if (req.method === 'GET' && url === '/api/scenarios') {
      return json(res, 200, { scenarios: Catalogue.SCENARIOS, categories: Catalogue.CATEGORIES });
    }
    if (req.method === 'GET' && url === '/api/builds') {
      return json(res, 200, { builds: Builds.listBuilds(), sharedLocation: ARTIFACTS_DIR });
    }
    if (req.method === 'POST' && url === '/api/builds') {
      const body = await readBody(req);
      return buildApp(body.version, (err, build) => {
        if (err) return json(res, 500, { error: 'build_failed', detail: err.message });
        return json(res, 201, { build });
      });
    }
    if (req.method === 'GET' && url === '/api/overview') {
      return json(res, 200, overview());
    }
    if (req.method === 'GET' && url === '/api/runs') {
      return json(res, 200, { runs: Array.from(runs.values()).slice(-100) });
    }
    let m = url.match(/^\/api\/runs\/([^/?]+)\/debug$/);
    if (req.method === 'GET' && m) {
      const run = runs.get(m[1]);
      if (!run) return json(res, 404, { error: 'run_not_found' });
      return json(res, 200, { runId: run.runId, deviceId: run.deviceId, status: run.status, debug: run.debug });
    }
    m = url.match(/^\/api\/runs\/([^/?]+)$/);
    if (req.method === 'GET' && m) {
      const run = runs.get(m[1]);
      if (!run) return json(res, 404, { error: 'run_not_found' });
      return json(res, 200, run);
    }
    m = url.match(/^\/api\/devices\/([^/?]+)\/install$/);
    if (req.method === 'POST' && m) {
      const body = await readBody(req);
      const out = dispatchInstall(m[1], body.buildId);
      return json(res, out.code || 202, out);
    }
    m = url.match(/^\/api\/devices\/([^/?]+)\/run$/);
    if (req.method === 'POST' && m) {
      const body = await readBody(req);
      const out = dispatchRun(m[1], body.scenarioId, false);
      return json(res, out.code || 202, out);
    }
    m = url.match(/^\/api\/devices\/([^/?]+)\/run-all$/);
    if (req.method === 'POST' && m) {
      const out = dispatchRun(m[1], null, true);
      return json(res, out.code || 202, out);
    }

    // -----------------------------------------------------------------------
    // Cloud device testing routes (BrowserStack / TV Labs)
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && url === '/api/cloud/providers') {
      return json(res, 200, Cloud.getProviders());
    }
    if (req.method === 'GET' && url === '/api/cloud/browserstack/devices') {
      try {
        const devices = await Cloud.getBrowserStackDevices();
        return json(res, 200, { provider: 'browserstack', devices });
      } catch (err) {
        return json(res, 502, { error: 'browserstack_error', detail: err.message });
      }
    }
    if (req.method === 'GET' && url === '/api/cloud/tvlabs/devices') {
      try {
        const devices = await Cloud.getTvLabsDevices();
        return json(res, 200, { provider: 'tvlabs', devices });
      } catch (err) {
        return json(res, 502, { error: 'tvlabs_error', detail: err.message });
      }
    }
    if (req.method === 'GET' && url === '/api/cloud/sessions') {
      return json(res, 200, { sessions: Cloud.listCloudSessions() });
    }
    m = url.match(/^\/api\/cloud\/sessions\/([^/?]+)\/logs$/);
    if (req.method === 'GET' && m) {
      const session = Cloud.getCloudSession(m[1]);
      if (!session) return json(res, 404, { error: 'session_not_found' });
      return json(res, 200, { sessionId: session.sessionId, logs: session.logs });
    }
    m = url.match(/^\/api\/cloud\/sessions\/([^/?]+)$/);
    if (req.method === 'GET' && m) {
      const session = Cloud.getCloudSession(m[1]);
      if (!session) return json(res, 404, { error: 'session_not_found' });
      return json(res, 200, Cloud.sessionSnapshot(session));
    }
    if (req.method === 'POST' && url === '/api/cloud/sessions') {
      const body = await readBody(req);
      if (!body.provider || !body.platform) {
        return json(res, 400, { error: 'provider_and_platform_required' });
      }
      const session = Cloud.createCloudSession(body);
      Cloud.runCloudSession(session, broadcastOperators);
      return json(res, 202, Cloud.sessionSnapshot(session));
    }

    return json(res, 404, { error: 'not_found' });
  }

  return serveStatic(req, res, url);
});

// ---------------------------------------------------------------------------
// Operator WebSocket (dashboard live updates only — devices use the broker)
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  operators.add(ws);
  ws.send(JSON.stringify({
    type: 'snapshot',
    devices: Array.from(devices.values()).map(deviceSummary),
    apps: Array.from(apps.values()).map(appSummary),
    cloudSessions: Cloud.listCloudSessions(),
  }));
  ws.on('close', () => operators.delete(ws));
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function start() {
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));

  let brokerUrl = MQTT_URL;
  if (!brokerUrl) {
    await startEmbeddedBroker(server, { mqttPort: MQTT_PORT, host: HOST });
    brokerUrl = 'mqtt://127.0.0.1:' + MQTT_PORT;
  }
  mqttClient = connectBroker(brokerUrl);

  /* eslint-disable no-console */
  console.log(`Ads SDK device manager listening on http://${HOST}:${PORT}`);
  console.log(`  Operator dashboard: http://localhost:${PORT}/`);
  console.log(`  Device test app:    http://localhost:${PORT}/app`);
  if (MQTT_URL) console.log(`  MQTT broker (ext):  ${MQTT_URL}`);
  else console.log(`  MQTT broker:        embedded — mqtt://<host>:${MQTT_PORT} · ws://<host>:${PORT}/mqtt`);
  console.log(`  Shared build store: ${ARTIFACTS_DIR} (served at /artifacts)`);
  return { server, mqttClient };
}

if (require.main === module) {
  start().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = {
  server, start, dispatchRun, dispatchInstall, buildApp, overview,
  devices, apps, runs, connectBroker, ARTIFACTS_DIR,
  get mqttClient() { return mqttClient; },
};
