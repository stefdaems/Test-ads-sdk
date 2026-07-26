/**
 * smoke-test.js
 *
 * End-to-end verification of the device harness WITHOUT a browser, exercising
 * the message-broker transport:
 *
 *   1. Boot the external manager (which starts the embedded MQTT broker).
 *   2. Connect a *simulated device* as an MQTT client that executes the real
 *      scenario runners (the same code the browser app runs) using the
 *      reference SDK adapter, announcing itself with app metadata.
 *   3. Drive the manager's REST API exactly like an external system would:
 *      list devices + apps, dispatch a single scenario, dispatch run-all.
 *   4. Assert the manager collected passing results for every scenario AND that
 *      live debug/trace events were captured for a run.
 *
 * Exits non-zero on any failure so it can be used in CI.
 */

'use strict';

const http = require('http');
const mqtt = require('mqtt');

const Catalogue = require('../shared/catalogue.js');
const Topics = require('../shared/topics.js');
const Scenarios = require('../app/scenarios.js');

const PORT = parseInt(process.env.SMOKE_PORT || '8099', 10);
const MQTT_PORT = parseInt(process.env.SMOKE_MQTT_PORT || '18830', 10);
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.MQTT_PORT = String(MQTT_PORT);

const Manager = require('../manager/server.js');

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

// A simulated device node: an MQTT client that registers, then runs scenarios
// on command, streaming live debug events + results back over the broker.
function startSimulatedDevice(deviceId) {
  const device = { id: deviceId, platform: 'tizen', make: 'samsung', model: 'QN90 (sim)', userAgent: 'sim', screen: '1920x1080' };
  const app = { id: 'adsdk-harness', name: 'Ads SDK Reference Harness', version: '1.0.0', sdk: 'reference', scenarioCount: Catalogue.SCENARIOS.length };
  const statusTopic = Topics.status(deviceId);
  const client = mqtt.connect(`mqtt://127.0.0.1:${MQTT_PORT}`, {
    clientId: 'sim-' + deviceId,
    will: { topic: statusTopic, payload: JSON.stringify({ status: 'offline' }), retain: true, qos: 1 },
  });

  function statusPayload(status) {
    return {
      status,
      device,
      app,
      scenarios: Catalogue.SCENARIOS.map((s) => ({ id: s.id, title: s.title, category: s.category })),
    };
  }

  function pub(topic, obj, opts) { client.publish(topic, JSON.stringify(obj), opts || {}); }

  async function runOne(runId, scenarioId) {
    pub(Topics.event(deviceId), { runId, scenarioId, kind: 'scenario_start' });
    const result = await Scenarios.run(scenarioId, {
      onEvent: (e) => pub(Topics.event(deviceId), { runId, scenarioId, kind: 'sdk_event', name: e.name }),
    });
    pub(Topics.event(deviceId), { runId, scenarioId, kind: 'scenario_end', status: result.status });
    pub(Topics.result(deviceId), { type: 'result', runId, deviceId, scenarioId, result });
    return result;
  }

  client.on('connect', () => {
    pub(statusTopic, statusPayload('online'), { retain: true, qos: 1 });
    pub(Topics.register, statusPayload('online'), { qos: 1 });
    client.subscribe(Topics.cmd(deviceId), { qos: 1 });
  });

  client.on('message', async (topic, buf) => {
    const msg = JSON.parse(buf.toString());
    if (msg.type === 'run') {
      await runOne(msg.runId, msg.scenarioId);
    } else if (msg.type === 'run_all') {
      const results = [];
      for (const s of Catalogue.SCENARIOS) results.push(await runOne(msg.runId, s.id));
      pub(Topics.runComplete(deviceId), { type: 'run_all_complete', runId: msg.runId, deviceId, results });
    }
  });

  return client;
}

async function main() {
  const failures = [];
  await Manager.start();

  const deviceId = 'sim-device-1';
  const client = startSimulatedDevice(deviceId);

  // Wait for the device to register through the broker.
  for (let i = 0; i < 100; i++) {
    const { body } = await get('/api/devices');
    if (body.devices && body.devices.some((d) => d.id === deviceId && d.status !== 'offline')) break;
    await delay(50);
  }

  // 1) External system lists devices + apps.
  const devicesResp = await get('/api/devices');
  const dev = (devicesResp.body.devices || []).find((d) => d.id === deviceId);
  if (!dev) failures.push('device did not register over broker');
  else console.log(`✓ device registered over broker: ${dev.platform}/${dev.model}`);

  const appsResp = await get('/api/apps');
  const seenApp = (appsResp.body.apps || []).find((a) => a.id === 'adsdk-harness');
  if (!seenApp) failures.push('app not listed in /api/apps');
  else console.log(`✓ app discovered: ${seenApp.name} v${seenApp.version} (${seenApp.deviceCount} device(s))`);

  // 2) Dispatch a single scenario and await its result.
  const single = await post(`/api/devices/${deviceId}/run`, { scenarioId: 'preroll' });
  if (single.status !== 202 || !single.body.runId) failures.push('single run not accepted');
  let singleRun = null;
  for (let i = 0; i < 100; i++) {
    const { body } = await get(`/api/runs/${single.body.runId}`);
    if (body.status === 'completed' && body.results.length) { singleRun = body; break; }
    await delay(50);
  }
  if (!singleRun) failures.push('single run did not complete');
  else if (singleRun.results[0].status !== 'passed') failures.push('preroll scenario failed');
  else console.log('✓ single scenario (preroll) executed on device and passed');

  // 2b) Live debug/trace of the run must be accessible.
  if (singleRun) {
    const dbg = await get(`/api/runs/${single.body.runId}/debug`);
    const events = (dbg.body.debug || []);
    const hasSdkEvent = events.some((e) => e.kind === 'sdk_event');
    const hasStart = events.some((e) => e.kind === 'scenario_start');
    if (!events.length || !hasSdkEvent || !hasStart) failures.push('debug follow-up not captured for run');
    else console.log(`✓ debug follow-up captured (${events.length} trace events)`);
  }

  // 3) Dispatch run-all and await completion.
  const all = await post(`/api/devices/${deviceId}/run-all`, {});
  let allRun = null;
  for (let i = 0; i < 300; i++) {
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

  client.end(true);
  await new Promise((resolve) => Manager.server.close(resolve));

  if (failures.length) {
    console.error('\nSMOKE TEST FAILED:');
    failures.forEach((f) => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nSMOKE TEST PASSED');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
