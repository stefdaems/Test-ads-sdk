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
 *   GET  /api/devices                      -> connected devices + status
 *   GET  /api/apps                         -> apps that can be tested
 *   GET  /api/scenarios                    -> scenario catalogue
 *   POST /api/devices/:deviceId/run        {scenarioId}  -> { runId }
 *   POST /api/devices/:deviceId/run-all                  -> { runId }
 *   GET  /api/runs                         -> recent runs
 *   GET  /api/runs/:runId                  -> run status + results + debug log
 *   GET  /api/runs/:runId/debug            -> live debug/trace log for a run
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mqtt = require('mqtt');
const { WebSocketServer } = require('ws');

const Catalogue = require('../shared/catalogue.js');
const Topics = require('../shared/topics.js');
const { startEmbeddedBroker } = require('./broker.js');

const PORT = parseInt(process.env.PORT || '8090', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883', 10);
const MQTT_URL = process.env.MQTT_URL || '';
const ROOT = path.resolve(__dirname, '..');
const MAX_DEBUG_PER_RUN = 2000;

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
  entry.status = 'idle';
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

function completeRun(runId, deviceId, results) {
  const run = runs.get(runId);
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

  let filePath;
  if (rel === '/vendor/mqtt.min.js') {
    filePath = MQTT_BUNDLE;
  } else {
    filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
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

function dispatchRun(deviceId, scenarioId, all) {
  const entry = devices.get(deviceId);
  if (!entry || entry.status === 'offline') return { error: 'device_not_connected', code: 404 };
  if (!all && !Catalogue.byId(scenarioId)) return { error: 'unknown_scenario', code: 400 };

  const runId = uuid();
  const run = {
    runId,
    deviceId,
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
  return { server, mqttClient };
}

if (require.main === module) {
  start().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { server, start, dispatchRun, devices, apps, runs, connectBroker, get mqttClient() { return mqttClient; } };
