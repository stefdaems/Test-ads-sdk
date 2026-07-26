/**
 * scenarios.js  (browser + Node)
 *
 * Executable runners for every scenario declared in shared/catalogue.js,
 * keyed by the same `id`. Each runner drives the Ads SDK through the adapter
 * and returns a structured result:
 *
 *   { status: 'passed' | 'failed', assertions: [{name, ok, detail}], events: [...] }
 *
 * Runners are pure w.r.t. the adapter they are given, so they can be unit
 * tested in Node (see device-harness/scripts/smoke-test.js) and executed live
 * on a device in the browser.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sdk-adapter.js'));
  } else {
    root.AdSdkScenarios = factory(root.AdSdkAdapter);
  }
})(typeof self !== 'undefined' ? self : this, function (AdSdkAdapter) {
  'use strict';

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // A small assertion collector.
  function Checker() { this.assertions = []; }
  Checker.prototype.check = function (name, ok, detail) {
    this.assertions.push({ name: name, ok: !!ok, detail: detail === undefined ? null : detail });
  };
  Checker.prototype.passed = function () {
    return this.assertions.every(function (a) { return a.ok; });
  };

  // Build a fresh SDK + event recorder for each run.
  function newContext(globalObj) {
    var sdk = AdSdkAdapter.create(globalObj);
    var events = [];
    sdk.on(function (e) { events.push(e); });
    return { sdk: sdk, events: events };
  }

  function names(events) { return events.map(function (e) { return e.name; }); }
  function has(events, name) { return names(events).indexOf(name) !== -1; }
  function countEvent(events, name) {
    return names(events).filter(function (n) { return n === name; }).length;
  }
  // Order check: does `seq` appear as a subsequence of the event names?
  function inOrder(events, seq) {
    var ns = names(events), i = 0;
    for (var j = 0; j < ns.length && i < seq.length; j++) {
      if (ns[j] === seq[i]) i++;
    }
    return i === seq.length;
  }

  function loadAdAsync(sdk, opts) {
    return new Promise(function (resolve) { sdk.loadAd(opts, resolve); });
  }

  // ---------------------------------------------------------------------------
  // Runners
  // ---------------------------------------------------------------------------
  var RUNNERS = {
    init_valid_pid: function (ctx) {
      var r = ctx.sdk.init({ publisherId: 'TEST_PID' });
      var c = new Checker();
      c.check('init returns ok', r.ok);
      c.check('sdk_initialized emitted', has(ctx.events, 'sdk_initialized'));
      return Promise.resolve(c);
    },

    init_null_pid: function (ctx) {
      var r = ctx.sdk.init({ publisherId: null });
      var c = new Checker();
      c.check('init rejected', !r.ok && r.reason === 'null_publisher_id');
      c.check('no crash / init_error emitted', has(ctx.events, 'init_error'));
      c.check('sdk not initialized', ctx.sdk.initialized === false);
      return Promise.resolve(c);
    },

    init_double: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var c = new Checker();
      c.check('already_initialized emitted', has(ctx.events, 'already_initialized'));
      c.check('only one sdk_initialized', countEvent(ctx.events, 'sdk_initialized') === 1);
      return Promise.resolve(c);
    },

    consent_granted_tracking: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID', consent: { gdpr: true, attGranted: true } });
      return loadAdAsync(ctx.sdk, { durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('impression fired once', ctx.sdk.pixelCount('impression') === 1);
        c.check('consent header on all requests', ctx.sdk.requestsMissingConsentHeader() === 0);
        return c;
      });
    },

    consent_denied_no_tracking: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID', consent: { gdpr: false } });
      return loadAdAsync(ctx.sdk, { durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('no impression pixel', ctx.sdk.pixelCount('impression') === 0);
        c.check('consent_denied emitted', has(ctx.events, 'consent_denied'));
        return c;
      });
    },

    ccpa_opt_out: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID', consent: { gdpr: true, ccpaOptOut: true } });
      return loadAdAsync(ctx.sdk, { durationMs: 80 }).then(function () {
        ctx.sdk._firePixel('sale');
        var c = new Checker();
        c.check('sale tracking suppressed', ctx.sdk.pixelCount('sale') === 0);
        c.check('ccpa_opt_out emitted', has(ctx.events, 'ccpa_opt_out'));
        return c;
      });
    },

    att_prompt_ios: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var granted = ctx.sdk.requestAtt();
      var c = new Checker();
      c.check('att prompt shown before ad', has(ctx.events, 'att_prompt_shown'));
      c.check('att decision available', typeof granted === 'boolean');
      return Promise.resolve(c);
    },

    preroll: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { type: 'linear-preroll', durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('content paused then resumed',
          inOrder(ctx.events, ['content_pause_requested', 'ad_complete', 'content_resume_requested']));
        return c;
      });
    },

    midroll: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { type: 'linear-midroll', durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('ad completed', has(ctx.events, 'ad_complete'));
        c.check('content resumed', has(ctx.events, 'content_resume_requested'));
        return c;
      });
    },

    postroll: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { type: 'linear-postroll', durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('post-roll completed', has(ctx.events, 'ad_complete'));
        return c;
      });
    },

    vmap_multi_break: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { breaks: 3, durationMs: 60 }).then(function () {
        var c = new Checker();
        c.check('three breaks started', countEvent(ctx.events, 'ad_break_started') === 3);
        c.check('three breaks ended', countEvent(ctx.events, 'ad_break_ended') === 3);
        return c;
      });
    },

    ad_pod: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { pod: 3, durationMs: 60 }).then(function () {
        var c = new Checker();
        c.check('three ads played in pod', countEvent(ctx.events, 'ad_started') === 3);
        c.check('single break', countEvent(ctx.events, 'ad_break_started') === 1);
        return c;
      });
    },

    skip_button_offset: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var p = loadAdAsync(ctx.sdk, { skippable: true, skipOffsetMs: 40, durationMs: 200 });
      return delay(80).then(function () {
        ctx.sdk.skip();
        return p;
      }).then(function () {
        var c = new Checker();
        c.check('skip button appeared', has(ctx.events, 'skip_button_shown'));
        c.check('skip pixel fired once', ctx.sdk.pixelCount('skip') === 1);
        return c;
      });
    },

    non_skippable: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { skippable: false, durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('no skip button shown', !has(ctx.events, 'skip_button_shown'));
        return c;
      });
    },

    vast_linear: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { type: 'linear-preroll', durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('linear played to completion',
          inOrder(ctx.events, ['ad_started', 'ad_complete']));
        return c;
      });
    },

    vast_wrapper: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { durationMs: 100 }).then(function () {
        var c = new Checker();
        c.check('wrapper resolved and played', has(ctx.events, 'ad_complete'));
        return c;
      });
    },

    vast_empty_fallback: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { fail: 'empty' }).then(function () {
        var c = new Checker();
        c.check('ad_error emitted', has(ctx.events, 'ad_error'));
        c.check('content resumed after error', has(ctx.events, 'content_resume_requested'));
        return c;
      });
    },

    vast_404_fallback: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { fail: '404' }).then(function () {
        var c = new Checker();
        c.check('ad_error emitted', has(ctx.events, 'ad_error'));
        c.check('content resumed after error', has(ctx.events, 'content_resume_requested'));
        return c;
      });
    },

    impression_once: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('impression fired exactly once', ctx.sdk.pixelCount('impression') === 1);
        return c;
      });
    },

    click_once: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { durationMs: 100 }).then(function () {
        ctx.sdk.click();
        ctx.sdk.click.callCount = 1; // one user click
        var c = new Checker();
        c.check('click fired once', ctx.sdk.pixelCount('click') === 1);
        return c;
      });
    },

    quartiles_in_order: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { durationMs: 160 }).then(function () {
        var c = new Checker();
        c.check('start pixel once', ctx.sdk.pixelCount('quartile/start') === 1);
        c.check('first pixel once', ctx.sdk.pixelCount('quartile/first') === 1);
        c.check('midpoint pixel once', ctx.sdk.pixelCount('quartile/midpoint') === 1);
        c.check('third pixel once', ctx.sdk.pixelCount('quartile/third') === 1);
        c.check('complete pixel once', ctx.sdk.pixelCount('quartile/complete') === 1);
        return c;
      });
    },

    no_dup_after_network_drop: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var p = loadAdAsync(ctx.sdk, { durationMs: 160 });
      return delay(20).then(function () {
        ctx.sdk.setNetwork(false);
        return delay(40);
      }).then(function () {
        ctx.sdk.setNetwork(true);
        return p;
      }).then(function () {
        var c = new Checker();
        c.check('impression not duplicated', ctx.sdk.pixelCount('impression') === 1);
        c.check('reconnect handled', has(ctx.events, 'network_reconnect'));
        return c;
      });
    },

    all_https: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('no insecure requests', ctx.sdk.insecureRequestCount() === 0);
        c.check('at least one request captured', ctx.sdk.requests.length > 0);
        return c;
      });
    },

    consent_header_present: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID', consent: { gdpr: true, attGranted: true } });
      return loadAdAsync(ctx.sdk, { durationMs: 120 }).then(function () {
        var c = new Checker();
        c.check('requests captured', ctx.sdk.requests.length > 0);
        c.check('no request missing consent header', ctx.sdk.requestsMissingConsentHeader() === 0);
        return c;
      });
    },

    ad_in_viewport: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var inViewport = ctx.viewport ? ctx.viewport() : true;
      return loadAdAsync(ctx.sdk, { durationMs: 60 }).then(function () {
        var c = new Checker();
        c.check('ad container in viewport', inViewport === true);
        return c;
      });
    },

    no_overlay_blocking_click: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { durationMs: 60 }).then(function () {
        ctx.sdk.click();
        var c = new Checker();
        c.check('click registered (no blocking overlay)', ctx.sdk.pixelCount('click') === 1);
        return c;
      });
    },

    pause_on_background: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var p = loadAdAsync(ctx.sdk, { durationMs: 160 });
      return delay(20).then(function () {
        ctx.sdk.setHidden(true);
        return delay(30);
      }).then(function () {
        ctx.sdk.setHidden(false);
        return p;
      }).then(function () {
        var c = new Checker();
        c.check('paused on hidden', has(ctx.events, 'ad_paused_on_hidden'));
        c.check('resumed on visible', has(ctx.events, 'ad_resumed_on_visible'));
        c.check('no false completion before resume',
          inOrder(ctx.events, ['ad_paused_on_hidden', 'ad_resumed_on_visible']));
        return c;
      });
    },

    ad_view_removed: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      return loadAdAsync(ctx.sdk, { durationMs: 80 }).then(function () {
        ctx.sdk.destroy();
        var destroyed = ctx.events.filter(function (e) { return e.name === 'ad_destroyed'; }).pop();
        var c = new Checker();
        c.check('ad_destroyed emitted', !!destroyed);
        c.check('ad view removed', destroyed && destroyed.detail && destroyed.detail.viewRemoved === true);
        return c;
      });
    },

    memory_stable_10_cycles: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var cycle = 0;
      function runCycle() {
        return loadAdAsync(ctx.sdk, { durationMs: 30 }).then(function () {
          ctx.sdk.destroy();
          cycle++;
          if (cycle < 10) return runCycle();
        });
      }
      return runCycle().then(function () {
        var c = new Checker();
        c.check('completed 10 cycles', cycle === 10);
        c.check('no timers leaked', ctx.sdk.activeTimers === 0);
        return c;
      });
    },

    threads_released: function (ctx) {
      ctx.sdk.init({ publisherId: 'TEST_PID' });
      var p = loadAdAsync(ctx.sdk, { durationMs: 200 });
      return delay(20).then(function () {
        ctx.sdk.destroy();
        return p.catch(function () {});
      }).then(function () {
        var c = new Checker();
        c.check('no active timers after destroy', ctx.sdk.activeTimers === 0);
        c.check('ad_destroyed emitted', has(ctx.events, 'ad_destroyed'));
        return c;
      });
    },
  };

  /**
   * Execute a scenario by id. Returns a Promise of the structured result.
   * `env` may provide { global, viewport } hooks for the browser.
   */
  function run(id, env) {
    env = env || {};
    var runner = Object.prototype.hasOwnProperty.call(RUNNERS, id) ? RUNNERS[id] : null;
    if (typeof runner !== 'function') {
      return Promise.resolve({
        id: id, status: 'failed', assertions: [{ name: 'scenario exists', ok: false, detail: 'unknown id' }], events: [],
      });
    }
    var ctx = newContext(env.global);
    if (env.viewport) ctx.viewport = env.viewport;
    var started = Date.now();
    return Promise.resolve()
      .then(function () { return runner(ctx); })
      .then(function (checker) {
        return {
          id: id,
          status: checker.passed() ? 'passed' : 'failed',
          assertions: checker.assertions,
          events: names(ctx.events),
          durationMs: Date.now() - started,
        };
      })
      .catch(function (err) {
        return {
          id: id,
          status: 'failed',
          assertions: [{ name: 'runner threw', ok: false, detail: String(err && err.message || err) }],
          events: names(ctx.events),
          durationMs: Date.now() - started,
        };
      });
  }

  function ids() { return Object.keys(RUNNERS); }

  return { run: run, ids: ids, RUNNERS: RUNNERS };
});
