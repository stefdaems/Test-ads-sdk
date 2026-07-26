/**
 * app.js  (browser)
 *
 * The on-device test app controller.
 *
 *  1. Detects device metadata + the app identity (so the manager can list which
 *     devices AND apps can be tested).
 *  2. Connects to the MQTT **message broker** (mqtt.js over WebSocket) and
 *     announces itself with a retained `status` message and a Last-Will so the
 *     manager sees it go offline if the connection drops. No direct link between
 *     the manager and this device is required — both are broker clients.
 *  3. Subscribes to its own command topic and runs `run` / `run_all` commands,
 *     streaming a live debug/trace event for every SDK event plus the final
 *     result back over the broker.
 *  4. Also exposes a local UI so the app can be driven manually on the device.
 *
 * The broker URL is taken from the `?broker=` query parameter, or defaults to
 * MQTT-over-WebSocket on the same host that served this page (path `/mqtt`).
 */

(function () {
  'use strict';

  var Catalogue = window.AdSdkCatalogue;
  var Scenarios = window.AdSdkScenarios;
  var Topics = window.AdSdkTopics;
  var mqtt = window.mqtt;

  // ---- App identity ---------------------------------------------------------
  var backend = window.AdSdkAdapter.create(window).backend;
  var APP = {
    id: 'adsdk-harness',
    name: 'Ads SDK Reference Harness',
    version: '1.0.0',
    sdk: backend,
    scenarioCount: Catalogue.SCENARIOS.length,
  };

  // ---- Device identity ------------------------------------------------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'dev-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function getDeviceId() {
    var id;
    try {
      id = localStorage.getItem('adsdk_device_id');
      if (!id) { id = uuid(); localStorage.setItem('adsdk_device_id', id); }
    } catch (e) { id = uuid(); }
    return id;
  }

  function detectDevice() {
    var ua = navigator.userAgent || '';
    var platform = 'web';
    var make = 'unknown';
    var model = 'unknown';
    if (/Tizen/i.test(ua)) { platform = 'tizen'; make = 'samsung'; }
    else if (/Web0S|webOS|LG/i.test(ua)) { platform = 'webos'; make = 'lg'; }
    else if (/VIZIO|SmartCast/i.test(ua)) { platform = 'vizio'; make = 'vizio'; }
    else if (/Android TV|GoogleTV|BRAVIA|AFT/i.test(ua)) { platform = 'androidtv'; make = 'android'; }
    else if (/Android/i.test(ua)) { platform = 'android'; make = 'android'; }
    else if (/iPhone|iPad|iPod/i.test(ua)) { platform = 'ios'; make = 'apple'; }
    var m = ua.match(/\(([^)]+)\)/);
    if (m) model = m[1].split(';').slice(-1)[0].trim() || model;
    return {
      id: getDeviceId(),
      platform: platform,
      make: make,
      model: model,
      userAgent: ua,
      screen: (window.screen ? (screen.width + 'x' + screen.height) : 'unknown'),
    };
  }

  var device = detectDevice();

  // ---- DOM ------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  $('device-id').textContent = device.id;
  $('device-desc').textContent = device.platform + ' / ' + device.make + ' / ' + device.model;

  var rowEls = {};
  function buildRows() {
    var tbody = $('rows');
    tbody.innerHTML = '';
    Catalogue.SCENARIOS.forEach(function (s) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><strong>' + s.title + '</strong><div class="cat" title="' + s.description + '">' + s.id + '</div></td>' +
        '<td class="cat">' + s.category + '</td>' +
        '<td><span class="st pending" data-st>pending</span></td>' +
        '<td data-assert>—</td>' +
        '<td><button class="secondary" data-run>Run</button></td>';
      tbody.appendChild(tr);
      rowEls[s.id] = tr;
      tr.querySelector('[data-run]').addEventListener('click', function () { runScenario(s.id, null); });
    });
  }

  function setRow(id, status, result) {
    var tr = rowEls[id];
    if (!tr) return;
    var st = tr.querySelector('[data-st]');
    st.textContent = status;
    st.className = 'st ' + status;
    if (result) {
      var passed = result.assertions.filter(function (a) { return a.ok; }).length;
      var cell = tr.querySelector('[data-assert]');
      cell.innerHTML = passed + '/' + result.assertions.length +
        '<details><summary>details</summary><pre>' +
        result.assertions.map(function (a) {
          return (a.ok ? '✓ ' : '✗ ') + a.name + (a.detail ? ' — ' + a.detail : '');
        }).join('\n') + '</pre></details>';
    }
  }

  // ---- Scenario execution ---------------------------------------------------
  function viewportHook() {
    // Reflect the on-screen ad surface so viewability checks are meaningful.
    var el = $('ad-container');
    el.classList.add('active');
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    setTimeout(function () { el.classList.remove('active'); }, 300);
    return visible;
  }

  function runScenario(id, runId) {
    setRow(id, 'running');
    publishEvent(runId, id, { kind: 'scenario_start' });
    var env = {
      global: window,
      viewport: viewportHook,
      onEvent: function (e) {
        publishEvent(runId, id, { kind: 'sdk_event', name: e.name, data: e.data === undefined ? null : e.data });
      },
    };
    return Scenarios.run(id, env).then(function (result) {
      setRow(id, result.status, result);
      publishEvent(runId, id, { kind: 'scenario_end', status: result.status });
      publish(Topics.result(device.id), { type: 'result', runId: runId, deviceId: device.id, scenarioId: id, result: result });
      return result;
    });
  }

  function runAll(runId) {
    var ids = Catalogue.SCENARIOS.map(function (s) { return s.id; });
    var i = 0;
    var results = [];
    function next() {
      if (i >= ids.length) {
        publish(Topics.runComplete(device.id), { type: 'run_all_complete', runId: runId, deviceId: device.id, results: results });
        return Promise.resolve(results);
      }
      return runScenario(ids[i++], runId).then(function (r) { results.push(r); return next(); });
    }
    return next();
  }

  // ---- Message broker (MQTT) ------------------------------------------------
  var client = null;

  function defaultBrokerUrl() {
    var q = new URLSearchParams(location.search).get('broker');
    if (q) return q;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (location.host) return proto + '//' + location.host + '/mqtt';
    return 'ws://localhost:8090/mqtt';
  }

  function setConn(on) {
    var el = $('conn');
    el.textContent = on ? 'connected' : 'disconnected';
    el.className = 'pill ' + (on ? 'on' : 'off');
  }

  function publish(topic, obj, opts) {
    if (client && client.connected) client.publish(topic, JSON.stringify(obj), opts || {});
  }

  function publishEvent(runId, scenarioId, ev) {
    if (!runId) return; // manual runs are not tied to a manager run
    publish(Topics.event(device.id), Object.assign({ runId: runId, scenarioId: scenarioId }, ev));
  }

  function statusPayload(status) {
    return {
      status: status,
      device: device,
      app: APP,
      scenarios: Catalogue.SCENARIOS.map(function (s) {
        return { id: s.id, title: s.title, category: s.category };
      }),
    };
  }

  function connect(url) {
    try { if (client) client.end(true); } catch (e) {}
    var statusTopic = Topics.status(device.id);
    try {
      client = mqtt.connect(url, {
        clientId: 'adsdk-device-' + device.id,
        clean: true,
        reconnectPeriod: 3000,
        will: { topic: statusTopic, payload: JSON.stringify({ status: 'offline' }), retain: true, qos: 1 },
      });
    } catch (e) {
      setConn(false);
      return;
    }
    client.on('connect', function () {
      setConn(true);
      // Retained status so a manager connecting later still discovers us…
      publish(statusTopic, statusPayload('online'), { retain: true, qos: 1 });
      // …and an explicit register for managers already listening.
      publish(Topics.register, statusPayload('online'), { qos: 1 });
      client.subscribe(Topics.cmd(device.id), { qos: 1 });
    });
    client.on('reconnect', function () { setConn(false); });
    client.on('close', function () { setConn(false); });
    client.on('error', function () { setConn(false); });
    client.on('message', function (topic, buf) {
      var msg;
      try { msg = JSON.parse(buf.toString()); } catch (e) { return; }
      if (msg.type === 'run') runScenario(msg.scenarioId, msg.runId);
      else if (msg.type === 'run_all') runAll(msg.runId);
    });
  }

  // ---- Wire up UI -----------------------------------------------------------
  buildRows();
  $('backend').textContent = 'sdk: ' + backend;
  $('backend').className = 'pill on';
  $('manager-url').value = defaultBrokerUrl();

  $('connect-btn').addEventListener('click', function () {
    connect($('manager-url').value);
  });
  $('run-all-btn').addEventListener('click', function () { runAll(null); });

  // Auto-connect if a broker was supplied via query string or via same-origin.
  if (mqtt && (new URLSearchParams(location.search).get('broker') || location.host)) {
    connect($('manager-url').value);
  }

  // Expose for debugging / automation.
  window.__adsdkHarness = { device: device, app: APP, runScenario: runScenario, runAll: runAll };
})();
