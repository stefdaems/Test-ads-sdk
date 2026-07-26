/**
 * build-app.js — build the on-device test app and store it in the SHARED location.
 *
 * On a cluster the app is built once (e.g. by a Kubernetes Job) and the bundle is
 * written to a shared artifacts volume that every manager replica can serve and
 * every device can download from. This decouples "building the app" from
 * "installing it on a device": the build is an immutable, content-addressed
 * artifact identified by a `buildId` (`<version>+<shortHash>`).
 *
 * What it does:
 *   1. Collect the app's source files (app/, shared/, the mqtt browser bundle).
 *   2. Compute a content hash over them so the same source always yields the same
 *      buildId (and the device can verify what it installed).
 *   3. Copy them into `ARTIFACTS_DIR/<appId>/<buildId>/` and write a manifest.
 *   4. Record the build in the shared registry (`ARTIFACTS_DIR/index.json`).
 *
 * Usage:  node scripts/build-app.js [--version 1.2.3]
 * Env:    ARTIFACTS_DIR  shared location to publish to (default ../artifacts)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Builds = require('../shared/builds.js');

const ROOT = path.resolve(__dirname, '..');
const APP_ID = 'adsdk-harness';
const APP_NAME = 'Ads SDK Reference Harness';

// Files that make up the installable on-device app, relative to the harness root.
const SOURCES = [
  'app/index.html',
  'app/app.js',
  'app/scenarios.js',
  'app/sdk-adapter.js',
  'shared/catalogue.js',
  'shared/topics.js',
];

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readVersion() {
  try { return require(path.join(ROOT, 'package.json')).version || '1.0.0'; }
  catch (e) { return '1.0.0'; }
}

function collectFiles() {
  const files = [];
  for (const rel of SOURCES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) throw new Error('missing source file: ' + rel);
    files.push({ rel, buf: fs.readFileSync(abs) });
  }
  // The mqtt browser bundle is served by the manager at /vendor/mqtt.min.js; ship
  // it inside the build too so a device can install fully self-contained.
  try {
    const mqttBundle = path.join(path.dirname(require.resolve('mqtt/package.json')), 'dist', 'mqtt.min.js');
    files.push({ rel: 'vendor/mqtt.min.js', buf: fs.readFileSync(mqttBundle) });
  } catch (e) { /* optional: manager still serves it at /vendor/mqtt.min.js */ }
  return files;
}

function hashFiles(files) {
  const h = crypto.createHash('sha256');
  for (const f of files.slice().sort((a, b) => a.rel.localeCompare(b.rel))) {
    h.update(f.rel); h.update('\0'); h.update(f.buf); h.update('\0');
  }
  return h.digest('hex');
}

function main() {
  const version = arg('version', readVersion());
  const files = collectFiles();
  const hash = hashFiles(files);
  const buildId = version + '+' + hash.slice(0, 12);

  const artifactsDir = Builds.artifactsDir();
  const buildDir = path.join(artifactsDir, APP_ID, buildId);
  fs.mkdirSync(buildDir, { recursive: true });

  const manifestFiles = [];
  for (const f of files) {
    const dest = path.join(buildDir, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.buf);
    manifestFiles.push({
      path: f.rel,
      bytes: f.buf.length,
      sha256: crypto.createHash('sha256').update(f.buf).digest('hex'),
    });
  }

  const baseUrl = '/artifacts/' + APP_ID + '/' + buildId + '/';
  const manifest = {
    appId: APP_ID,
    name: APP_NAME,
    version,
    buildId,
    hash,
    entry: 'app/index.html',
    baseUrl,
    files: manifestFiles,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(buildDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  Builds.addBuild({
    appId: APP_ID,
    name: APP_NAME,
    version,
    buildId,
    hash,
    baseUrl,
    manifestUrl: baseUrl + 'manifest.json',
    entryUrl: baseUrl + manifest.entry,
    fileCount: manifestFiles.length,
    builtAt: manifest.builtAt,
  });

  /* eslint-disable no-console */
  console.log('Built ' + APP_ID + ' ' + buildId);
  console.log('  shared location: ' + buildDir);
  console.log('  manifest:        ' + baseUrl + 'manifest.json');
  return buildId;
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('build failed:', err.message); process.exit(1); }
}

module.exports = { main, APP_ID };
