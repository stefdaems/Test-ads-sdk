/**
 * app.js  (browser)
 *
 * The on-device test app controller.
 *
 *  1. Detects device metadata.
 *  2. Connects to the external manager over WebSocket and registers itself,
 *     advertising its scenario catalogue.
 *  3. Waits for `run` / `run_all` commands from the manager and executes the
 *     matching scenario runner on THIS device, streaming events and the final
 *     result back.
 *  4. Also exposes a local UI so the app can be driven manually on the device.
 *
 * The manager WebSocket URL is taken from the `?manager=` query parameter, or
 * defaults to the same host that served this page (path `/ws`).
 */

(function () {
  'use strict';

  var Catalogue = window.AdSdkCatalogue;
  var Scenarios = window.AdSdkScenarios;

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
    return Scenarios.run(id, { global: window, viewport: viewportHook }).then(function (result) {
      setRow(id, result.status, result);
      send({ type: 'result', runId: runId, deviceId: device.id, scenarioId: id, result: result });
      return result;
    });
  }

  function runAll(runId) {
    var ids = Catalogue.SCENARIOS.map(function (s) { return s.id; });
    var i = 0;
    var results = [];
    function next() {
      if (i >= ids.length) {
        send({ type: 'run_all_complete', runId: runId, deviceId: device.id, results: results });
        return Promise.resolve(results);
      }
      return runScenario(ids[i++], runId).then(function (r) { results.push(r); return next(); });
    }
    return next();
  }

  // ---- Manager WebSocket ----------------------------------------------------
  var ws = null;

  function defaultManagerUrl() {
    var q = new URLSearchParams(location.search).get('manager');
    if (q) return q;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (location.host) return proto + '//' + location.host + '/ws';
    return 'ws://localhost:8090/ws';
  }

  function setConn(on) {
    var el = $('conn');
    el.textContent = on ? 'connected' : 'disconnected';
    el.className = 'pill ' + (on ? 'on' : 'off');
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function connect(url) {
    try { if (ws) ws.close(); } catch (e) {}
    try {
      ws = new WebSocket(url + (url.indexOf('?') === -1 ? '?role=device' : '&role=device'));
    } catch (e) {
      setConn(false);
      return;
    }
    ws.onopen = function () {
      setConn(true);
      send({
        type: 'register',
        device: device,
        scenarios: Catalogue.SCENARIOS.map(function (s) {
          return { id: s.id, title: s.title, category: s.category };
        }),
      });
    };
    ws.onclose = function () { setConn(false); setTimeout(function () {
      if ($('manager-url').dataset.auto === '1') connect($('manager-url').value);
    }, 3000); };
    ws.onerror = function () { setConn(false); };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'run') runScenario(msg.scenarioId, msg.runId);
      else if (msg.type === 'run_all') runAll(msg.runId);
      else if (msg.type === 'ping') send({ type: 'pong', deviceId: device.id });
    };
  }

  // ---- Wire up UI -----------------------------------------------------------
  buildRows();
  $('backend').textContent = 'sdk: ' + window.AdSdkAdapter.create(window).backend;
  $('backend').className = 'pill on';
  $('manager-url').value = defaultManagerUrl();

  $('connect-btn').addEventListener('click', function () {
    $('manager-url').dataset.auto = '1';
    connect($('manager-url').value);
  });
  $('run-all-btn').addEventListener('click', function () { runAll(null); });

  // Auto-connect if a manager was supplied via query string.
  if (new URLSearchParams(location.search).get('manager') || location.host) {
    $('manager-url').dataset.auto = '1';
    connect($('manager-url').value);
  }

  // Expose for debugging / automation.
  window.__adsdkHarness = { device: device, runScenario: runScenario, runAll: runAll };
})();
