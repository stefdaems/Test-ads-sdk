/**
 * smoke-test.js
 *
 * End-to-end verification of the device harness WITHOUT a browser:
 *
 *   1. Boot the external manager.
 *   2. Connect a *simulated device* over WebSocket that executes the real
 *      scenario runners (the same code the browser app runs) using the
 *      reference SDK adapter.
 *   3. Drive the manager's REST API exactly like an external system would:
 *      list devices, dispatch a single scenario, dispatch run-all.
 *   4. Assert the manager collected passing results for every scenario.
 *
 * Exits non-zero on any failure so it can be used in CI.
 */

'use strict';

const http = require('http');
const { WebSocket } = require('ws');

const Catalogue = require('../shared/catalogue.js');
const Scenarios = require('../app/scenarios.js');

const PORT = parseInt(process.env.SMOKE_PORT || '8099', 10);
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';

const { server } = require('../manager/server.js');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
    }).on('error', reject);
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// A simulated device node: connects, registers, and runs scenarios on command.
function startSimulatedDevice(deviceId) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?role=device`);
  const device = { id: deviceId, platform: 'tizen', make: 'samsung', model: 'QN90 (sim)', userAgent: 'sim', screen: '1920x1080' };

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'register',
      device,
      scenarios: Catalogue.SCENARIOS.map((s) => ({ id: s.id, title: s.title, category: s.category })),
    }));
  });

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'run') {
      const result = await Scenarios.run(msg.scenarioId, {});
      ws.send(JSON.stringify({ type: 'result', runId: msg.runId, deviceId, scenarioId: msg.scenarioId, result }));
    } else if (msg.type === 'run_all') {
      const results = [];
      for (const s of Catalogue.SCENARIOS) {
        const result = await Scenarios.run(s.id, {});
        results.push(result);
        ws.send(JSON.stringify({ type: 'result', runId: msg.runId, deviceId, scenarioId: s.id, result }));
      }
      ws.send(JSON.stringify({ type: 'run_all_complete', runId: msg.runId, deviceId, results }));
    }
  });

  return ws;
}

async function main() {
  const failures = [];
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const deviceId = 'sim-device-1';
  const ws = startSimulatedDevice(deviceId);

  // Wait for the device to register.
  for (let i = 0; i < 50; i++) {
    const { body } = await get('/api/devices');
    if (body.devices && body.devices.length === 1) break;
    await delay(50);
  }

  // 1) External system lists devices.
  const devicesResp = await get('/api/devices');
  if (devicesResp.body.devices.length !== 1) failures.push('device did not register');
  else console.log(`✓ device registered: ${devicesResp.body.devices[0].platform}/${devicesResp.body.devices[0].model}`);

  // 2) Dispatch a single scenario and await its result.
  const single = await post(`/api/devices/${deviceId}/run`, { scenarioId: 'preroll' });
  if (single.status !== 202 || !single.body.runId) failures.push('single run not accepted');
  let singleRun = null;
  for (let i = 0; i < 60; i++) {
    const { body } = await get(`/api/runs/${single.body.runId}`);
    if (body.status === 'completed' && body.results.length) { singleRun = body; break; }
    await delay(50);
  }
  if (!singleRun) failures.push('single run did not complete');
  else if (singleRun.results[0].status !== 'passed') failures.push('preroll scenario failed');
  else console.log('✓ single scenario (preroll) executed on device and passed');

  // 3) Dispatch run-all and await completion.
  const all = await post(`/api/devices/${deviceId}/run-all`, {});
  let allRun = null;
  for (let i = 0; i < 200; i++) {
    const { body } = await get(`/api/runs/${all.body.runId}`);
    if (body.status === 'completed' && body.results.length >= Catalogue.SCENARIOS.length) { allRun = body; break; }
    await delay(50);
  }
  if (!allRun) failures.push('run-all did not complete');
  else {
    const passed = allRun.results.filter((r) => r.status === 'passed').length;
    const total = allRun.results.length;
    console.log(`✓ run-all executed ${total} scenarios, ${passed} passed`);
    const failed = allRun.results.filter((r) => r.status !== 'passed');
    if (failed.length) {
      failed.forEach((f) => {
        const bad = f.assertions.filter((a) => !a.ok).map((a) => a.name).join(', ');
        failures.push(`scenario ${f.id} failed: ${bad}`);
      });
    }
  }

  ws.close();
  await new Promise((resolve) => server.close(resolve));

  if (failures.length) {
    console.error('\nSMOKE TEST FAILED:');
    failures.forEach((f) => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nSMOKE TEST PASSED');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
