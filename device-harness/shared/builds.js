/**
 * builds.js — helpers for the shared build/artifact store.
 *
 * When the harness runs on a cluster, the on-device app is *built* once and the
 * resulting bundle is written to a **shared location** (an object store or, by
 * default, a shared filesystem such as a Kubernetes PersistentVolume mounted
 * into every manager replica). Devices later download and "install" that bundle
 * from the same shared location before a test run.
 *
 * This module is the single source of truth for *where* that shared location is
 * and *how* the build registry (an `index.json` catalogue of builds) is read and
 * written. It is used by:
 *   - scripts/build-app.js  (writes builds)
 *   - manager/server.js     (lists builds, serves artifacts, dispatches installs)
 *
 * It only depends on Node's stdlib so it works in the build container, the
 * manager container and the smoke test without extra dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Resolve the shared artifacts directory (backed by a PVC / shared volume in a cluster). */
function artifactsDir() {
  return path.resolve(process.env.ARTIFACTS_DIR || path.join(__dirname, '..', 'artifacts'));
}

/** Path to the shared build registry index. */
function indexPath(dir) {
  return path.join(dir || artifactsDir(), 'index.json');
}

/** Read the build registry. Returns `{ builds: [] }` when nothing has been built yet. */
function readIndex(dir) {
  const p = indexPath(dir);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { builds: [] };
  }
}

/** Persist the build registry to the shared location. */
function writeIndex(index, dir) {
  const d = dir || artifactsDir();
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(indexPath(d), JSON.stringify(index, null, 2));
}

/** Add (or replace) a build entry in the shared registry, keeping newest first. */
function addBuild(entry, dir) {
  const index = readIndex(dir);
  index.builds = (index.builds || []).filter((b) => b.buildId !== entry.buildId);
  index.builds.unshift(entry);
  writeIndex(index, dir);
  return entry;
}

/** List all builds recorded in the shared registry (newest first). */
function listBuilds(dir) {
  return readIndex(dir).builds || [];
}

/** Look up a single build by id. */
function getBuild(buildId, dir) {
  return listBuilds(dir).find((b) => b.buildId === buildId) || null;
}

module.exports = { artifactsDir, indexPath, readIndex, writeIndex, addBuild, listBuilds, getBuild };
