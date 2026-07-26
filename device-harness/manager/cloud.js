/**
 * cloud.js — BrowserStack & TV Labs cloud-device integration for the manager.
 *
 * Provides:
 *   - Device catalogue fetching from BrowserStack App Automate and TV Labs REST APIs
 *   - Cloud test session lifecycle (create → run → capture result)
 *   - Session state kept in memory; broadcasted to operator WebSocket clients
 *
 * Environment variables consumed:
 *   BROWSERSTACK_USERNAME    — BrowserStack account username
 *   BROWSERSTACK_ACCESS_KEY  — BrowserStack access key
 *   TVLABS_API_KEY           — TV Labs API key (https://tvlabs.ai/app/keys)
 */

'use strict';

const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');

// Root of the monorepo (two levels up from manager/)
const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------
const cloudSessions = new Map();

// ---------------------------------------------------------------------------
// Generic HTTPS helper
// ---------------------------------------------------------------------------
function httpsRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyBuf = body
      ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
      : null;

    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { ...headers },
    };

    if (bodyBuf) {
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = bodyBuf.length;
    }

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); }
      });
    });

    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

function bsAuthHeader() {
  const u = process.env.BROWSERSTACK_USERNAME;
  const k = process.env.BROWSERSTACK_ACCESS_KEY;
  if (!u || !k) throw new Error('BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be set');
  return { Authorization: `Basic ${Buffer.from(`${u}:${k}`).toString('base64')}` };
}

function tvlabsApiKey() {
  const k = process.env.TVLABS_API_KEY;
  if (!k) throw new Error('TVLABS_API_KEY must be set — get yours at https://tvlabs.ai/app/keys');
  return k;
}

// ---------------------------------------------------------------------------
// Device catalogue
// ---------------------------------------------------------------------------

/**
 * Fetch the list of real devices available on BrowserStack App Automate.
 * Returns an array of device objects: [{ device, os, os_version, … }, …]
 */
async function getBrowserStackDevices() {
  const data = await httpsRequest(
    'GET',
    'https://api-cloud.browserstack.com/app-automate/devices.json',
    bsAuthHeader(),
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch the list of real devices available on TV Labs.
 * Returns an array of device objects.
 */
async function getTvLabsDevices() {
  const key = tvlabsApiKey();
  const data = await httpsRequest(
    'GET',
    `https://tvlabs.ai/api/v2/devices?api_key=${encodeURIComponent(key)}`,
    { Accept: 'application/json' },
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.devices)) return data.devices;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

// ---------------------------------------------------------------------------
// Provider availability
// ---------------------------------------------------------------------------

/**
 * Returns which cloud providers are configured (env vars are present).
 * @returns {{ browserstack: boolean, tvlabs: boolean }}
 */
function getProviders() {
  return {
    browserstack: !!(process.env.BROWSERSTACK_USERNAME && process.env.BROWSERSTACK_ACCESS_KEY),
    tvlabs: !!process.env.TVLABS_API_KEY,
  };
}

// ---------------------------------------------------------------------------
// Cloud session lifecycle
// ---------------------------------------------------------------------------

function nowIso() { return new Date().toISOString(); }

/**
 * Create a new cloud test session record (does not start the run yet).
 *
 * @param {object} opts
 * @param {'browserstack'|'tvlabs'} opts.provider
 * @param {string} opts.platform   e.g. 'android', 'ios', 'tvos', 'webos', 'tizen'
 * @param {string} [opts.deviceId]
 * @param {string} [opts.deviceName]
 * @param {string} [opts.buildPath] Path to the artifact to upload; if omitted the
 *                                   script will build from source.
 * @param {string} [opts.scenarioId]
 * @returns {object} session
 */
function createCloudSession({ provider, platform, deviceId, deviceName, buildPath, scenarioId }) {
  const sessionId = crypto.randomUUID();
  const session = {
    sessionId,
    provider,
    platform: platform || 'android',
    deviceId: deviceId || null,
    deviceName: deviceName || null,
    buildPath: buildPath || null,
    scenarioId: scenarioId || null,
    status: 'pending',
    createdAt: nowIso(),
    completedAt: null,
    logs: [],
    result: null,
    error: null,
  };
  cloudSessions.set(sessionId, session);
  return session;
}

/** Return a lightweight snapshot of a session (no full log array). */
function sessionSnapshot(s) {
  return {
    sessionId: s.sessionId,
    provider: s.provider,
    platform: s.platform,
    deviceId: s.deviceId,
    deviceName: s.deviceName,
    scenarioId: s.scenarioId,
    status: s.status,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
    result: s.result,
    error: s.error,
    logCount: s.logs.length,
  };
}

function getCloudSession(sessionId) {
  return cloudSessions.get(sessionId) || null;
}

function listCloudSessions() {
  return Array.from(cloudSessions.values())
    .slice(-50)
    .reverse()
    .map(sessionSnapshot);
}

/**
 * Execute a cloud test session by spawning scripts/install-apps.ts as a
 * child process and streaming its output back to operator clients.
 *
 * @param {object} session  Session record created by createCloudSession().
 * @param {Function} [broadcaster]  Callback invoked with WebSocket event objects.
 */
function runCloudSession(session, broadcaster) {
  const { sessionId, provider, platform, buildPath } = session;

  // Build the install-apps.ts argument list
  const scriptPath = path.join(ROOT, 'scripts', 'install-apps.ts');
  const args = ['--platform', platform, '--remote', provider];

  // Resolve ts-node binary: prefer the one in the monorepo's node_modules
  const tsNodeBin = path.join(ROOT, 'node_modules', '.bin', 'ts-node');

  const env = { ...process.env };

  // Mark running
  session.status = 'running';
  if (broadcaster) broadcaster({ type: 'cloud_session_update', session: sessionSnapshot(session) });

  function appendLog(line) {
    if (!line) return;
    const entry = { ts: nowIso(), line };
    session.logs.push(entry);
    // Prevent unbounded growth
    if (session.logs.length > 2000) session.logs.shift();
    if (broadcaster) broadcaster({ type: 'cloud_log', sessionId, entry });
  }

  appendLog(`▶ Starting cloud test — provider: ${provider}, platform: ${platform}`);
  if (buildPath) appendLog(`  artifact: ${buildPath}`);

  const child = execFile(tsNodeBin, [scriptPath, ...args], { env, cwd: ROOT });

  const onData = (d) => String(d).split('\n').forEach((l) => appendLog(l.trimEnd()));
  if (child.stdout) child.stdout.on('data', onData);
  if (child.stderr) child.stderr.on('data', onData);

  child.on('close', (code) => {
    session.completedAt = nowIso();
    if (code === 0) {
      session.status = 'completed';
      session.result = { status: 'passed' };
      appendLog(`✅ Test session completed successfully`);
    } else {
      session.status = 'failed';
      session.error = `Process exited with code ${code}`;
      session.result = { status: 'failed', exitCode: code };
      appendLog(`❌ Test session failed (exit code ${code})`);
    }
    if (broadcaster) broadcaster({ type: 'cloud_session_update', session: sessionSnapshot(session) });
  });

  child.on('error', (err) => {
    session.status = 'failed';
    session.error = err.message;
    session.completedAt = nowIso();
    appendLog(`❌ Error: ${err.message}`);
    if (broadcaster) broadcaster({ type: 'cloud_session_update', session: sessionSnapshot(session) });
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getProviders,
  getBrowserStackDevices,
  getTvLabsDevices,
  createCloudSession,
  getCloudSession,
  listCloudSessions,
  runCloudSession,
  sessionSnapshot,
  cloudSessions,
};
