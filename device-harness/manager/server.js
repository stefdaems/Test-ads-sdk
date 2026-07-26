/**
 * server.js — External Manager for the on-device Ads SDK test app.
 *
 * Responsibilities:
 *   1. Serve the on-device test app (device-harness/app) and the shared
 *      catalogue so a device can simply open a URL to become a test node.
 *   2. Serve the operator dashboard (device-harness/manager/public).
 *   3. Accept device WebSocket connections (`/ws?role=device`), track them,
 *      and dispatch scenario-run commands to a specific device.
 *   4. Expose a REST API so *any external system* can list connected devices
 *      and instruct a chosen device to execute a scenario, then read results.
 *
 * REST API
 *   GET  /api/health
 *   GET  /api/devices                      -> connected devices + status
 *   GET  /api/scenarios                    -> scenario catalogue
 *   POST /api/devices/:deviceId/run        {scenarioId}  -> { runId }
 *   POST /api/devices/:deviceId/run-all                  -> { runId }
 *   GET  /api/runs                         -> recent runs
 *   GET  /api/runs/:runId                  -> run status + results
 *
 * No framework dependencies beyond `ws`.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const Catalogue = require('../shared/catalogue.js');

const PORT = parseInt(process.env.PORT || '8090', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
/** deviceId -> { device, ws, connectedAt, lastSeen, status } */
const devices = new Map();
/** runId -> run */
const runs = new Map();
const operators = new Set();

function uuid() { return crypto.randomUUID(); }

function deviceSummary(entry) {
  return {
    id: entry.device.id,
    platform: entry.device.platform,
    make: entry.device.make,
    model: entry.device.model,
    screen: entry.device.screen,
    userAgent: entry.device.userAgent,
    status: entry.status,
    connectedAt: entry.connectedAt,
    lastSeen: entry.lastSeen,
    scenarioCount: (entry.scenarios || []).length,
  };
}

function broadcastOperators(msg) {
  const data = JSON.stringify(msg);
  for (const op of operators) {
    if (op.readyState === 1) op.send(data);
  }
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

function serveStatic(req, res, urlPath) {
  // Map URL -> file under ROOT, preventing path traversal.
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/manager/public/index.html';
  else if (rel === '/app' || rel === '/app/') rel = '/app/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
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
  if (!entry) return { error: 'device_not_connected', code: 404 };
  if (!all && !Catalogue.byId(scenarioId)) return { error: 'unknown_scenario', code: 400 };

  const runId = uuid();
  const run = {
    runId,
    deviceId,
    scenarioId: all ? null : scenarioId,
    type: all ? 'all' : 'single',
    status: 'dispatched',
    createdAt: new Date().toISOString(),
    results: [],
  };
  runs.set(runId, run);
  entry.status = 'running';

  const cmd = all
    ? { type: 'run_all', runId }
    : { type: 'run', runId, scenarioId };
  if (entry.ws.readyState === 1) entry.ws.send(JSON.stringify(cmd));

  broadcastOperators({ type: 'run_created', run });
  return { runId };
}

// ---------------------------------------------------------------------------
// HTTP router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/api/')) {
    // ----- API routes -----
    if (req.method === 'GET' && url === '/api/health') {
      return json(res, 200, { ok: true, devices: devices.size, runs: runs.size });
    }
    if (req.method === 'GET' && url === '/api/devices') {
      return json(res, 200, { devices: Array.from(devices.values()).map(deviceSummary) });
    }
    if (req.method === 'GET' && url === '/api/scenarios') {
      return json(res, 200, { scenarios: Catalogue.SCENARIOS, categories: Catalogue.CATEGORIES });
    }
    if (req.method === 'GET' && url === '/api/runs') {
      return json(res, 200, { runs: Array.from(runs.values()).slice(-100) });
    }
    let m = url.match(/^\/api\/runs\/([^/?]+)$/);
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
// WebSocket layer
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams((req.url || '').split('?')[1] || '');
  const role = params.get('role') || 'device';

  if (role === 'operator') {
    operators.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', devices: Array.from(devices.values()).map(deviceSummary) }));
    ws.on('close', () => operators.delete(ws));
    return;
  }

  // Device role
  let deviceId = null;
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }

    if (msg.type === 'register' && msg.device && msg.device.id) {
      deviceId = msg.device.id;
      devices.set(deviceId, {
        device: msg.device,
        scenarios: msg.scenarios || [],
        ws,
        connectedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        status: 'idle',
      });
      broadcastOperators({ type: 'device_connected', device: deviceSummary(devices.get(deviceId)) });
      return;
    }

    if (!deviceId || !devices.has(deviceId)) return;
    const entry = devices.get(deviceId);
    entry.lastSeen = new Date().toISOString();

    if (msg.type === 'result') {
      const run = runs.get(msg.runId);
      if (run) {
        run.results.push(msg.result);
        run.status = run.type === 'single' ? 'completed' : 'running';
      }
      entry.status = 'idle';
      broadcastOperators({ type: 'result', runId: msg.runId, deviceId, result: msg.result });
    } else if (msg.type === 'run_all_complete') {
      const run = runs.get(msg.runId);
      if (run) { run.status = 'completed'; run.results = msg.results || run.results; }
      entry.status = 'idle';
      broadcastOperators({ type: 'run_all_complete', runId: msg.runId, deviceId, results: msg.results });
    }
  });

  ws.on('close', () => {
    if (deviceId && devices.has(deviceId)) {
      devices.delete(deviceId);
      broadcastOperators({ type: 'device_disconnected', deviceId });
    }
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    /* eslint-disable no-console */
    console.log(`Ads SDK device manager listening on http://${HOST}:${PORT}`);
    console.log(`  Operator dashboard: http://localhost:${PORT}/`);
    console.log(`  Device test app:    http://localhost:${PORT}/app`);
    console.log(`  Device WS endpoint: ws://localhost:${PORT}/ws`);
  });
}

module.exports = { server, dispatchRun, devices, runs };
