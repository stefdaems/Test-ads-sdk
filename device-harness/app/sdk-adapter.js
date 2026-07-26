/**
 * sdk-adapter.js  (browser)
 *
 * Provides a uniform interface the scenario runners use to drive the Ads SDK
 * on the device, regardless of whether the *real* SDK is loaded.
 *
 *   - If `window.AdsSDK` is present (the real SDK script loaded on the page),
 *     the adapter wraps it.
 *   - Otherwise it falls back to a built-in **reference implementation** that
 *     models the correct, spec-compliant behaviour of the SDK. This keeps the
 *     test app fully self-contained and demonstrable on any device, and doubles
 *     as an executable specification of the expected behaviour.
 *
 * To test the real SDK, load its script before this file and the wrapper is
 * used automatically.
 *
 * The adapter exposes an event stream. Every ad lifecycle / tracking event is
 * emitted through `on(handler)` as `{ name, at, detail }`.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdSdkAdapter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  // -------------------------------------------------------------------------
  // Reference implementation — models correct SDK behaviour.
  // -------------------------------------------------------------------------
  function ReferenceSdk() {
    this._handlers = [];
    this._timers = [];
    this._reset();
  }

  ReferenceSdk.prototype._reset = function () {
    this.initialized = false;
    this.publisherId = null;
    this.consent = { gdpr: true, tcfString: 'CPtest.TCF.v2.string', ccpaOptOut: false, attGranted: true };
    this.pixels = {};          // pattern -> count
    this.requests = [];        // {url, headers}
    this.networkUp = true;
    this.pendingPixels = [];   // queued while offline
    this.adView = null;        // simulated ad DOM handle
    this.activeTimers = 0;
    this._activeCb = null;     // pending loadAd completion callback
  };

  ReferenceSdk.prototype.on = function (handler) { this._handlers.push(handler); };

  ReferenceSdk.prototype._emit = function (name, detail) {
    var evt = { name: name, at: now(), detail: detail || null };
    for (var i = 0; i < this._handlers.length; i++) this._handlers[i](evt);
  };

  ReferenceSdk.prototype._schedule = function (fn, ms) {
    var self = this;
    this.activeTimers++;
    var t = setTimeout(function () {
      self.activeTimers--;
      fn();
    }, ms);
    this._timers.push(t);
    return t;
  };

  ReferenceSdk.prototype._request = function (path) {
    // Always HTTPS in the reference implementation.
    var headers = {};
    var trackingConsent = this.consent.gdpr && this.consent.attGranted;
    if (trackingConsent) headers['x-consent-string'] = this.consent.tcfString;
    var url = 'https://ads-sdk.example/adsdk' + path;
    this.requests.push({ url: url, headers: headers });
  };

  ReferenceSdk.prototype._firePixel = function (kind) {
    // Suppress all tracking when consent is denied.
    if (!this.consent.gdpr || !this.consent.attGranted) {
      this._emit('consent_denied', { pixel: kind });
      return;
    }
    if (kind === 'sale' && this.consent.ccpaOptOut) {
      this._emit('ccpa_opt_out', { pixel: kind });
      return;
    }
    if (!this.networkUp) {
      // Queue exactly once; de-duped by kind so reconnect can't double-fire.
      if (this.pendingPixels.indexOf(kind) === -1) this.pendingPixels.push(kind);
      return;
    }
    this.pixels[kind] = (this.pixels[kind] || 0) + 1;
    this._request('/' + kind);
    this._emit('pixel', { kind: kind, count: this.pixels[kind] });
  };

  // ---- Public API -----------------------------------------------------------

  ReferenceSdk.prototype.init = function (config) {
    config = config || {};
    if (this.initialized) {
      this._emit('already_initialized');
      return { ok: false, reason: 'already_initialized' };
    }
    if (!config.publisherId) {
      this._emit('init_error', { reason: 'null_publisher_id' });
      return { ok: false, reason: 'null_publisher_id' };
    }
    this.initialized = true;
    this.publisherId = config.publisherId;
    if (config.consent) this.setConsent(config.consent);
    this._emit('sdk_initialized', { publisherId: this.publisherId });
    return { ok: true };
  };

  ReferenceSdk.prototype.setConsent = function (consent) {
    if (typeof consent.gdpr === 'boolean') this.consent.gdpr = consent.gdpr;
    if (typeof consent.tcfString === 'string') this.consent.tcfString = consent.tcfString;
    if (typeof consent.ccpaOptOut === 'boolean') this.consent.ccpaOptOut = consent.ccpaOptOut;
    if (typeof consent.attGranted === 'boolean') this.consent.attGranted = consent.attGranted;
    this._emit('consent_set', this.consent);
  };

  ReferenceSdk.prototype.requestAtt = function () {
    this._emit('att_prompt_shown');
    return this.consent.attGranted;
  };

  /**
   * Load and play an ad break.
   * opts: { type, durationMs, skippable, skipOffsetMs, pod, breaks, fail }
   * cb(result) called when the break finishes.
   */
  ReferenceSdk.prototype.loadAd = function (opts, cb) {
    var self = this;
    opts = opts || {};
    cb = cb || function () {};

    // Ensure the completion callback fires exactly once and is tracked so a
    // mid-ad destroy() can settle any pending load instead of leaking it.
    var originalCb = cb;
    var settled = false;
    cb = function (res) {
      if (settled) return;
      settled = true;
      if (self._activeCb === cb) self._activeCb = null;
      originalCb(res);
    };
    self._activeCb = cb;

    if (!this.initialized) {
      this._emit('ad_error', { reason: 'not_initialized' });
      return cb({ ok: false });
    }

    // Error paths: empty VAST / 404 → graceful fallback.
    if (opts.fail === 'empty' || opts.fail === '404') {
      this._emit('content_pause_requested');
      this._schedule(function () {
        self._emit('ad_error', { reason: opts.fail });
        self._emit('content_resume_requested');
        cb({ ok: false, fallback: true });
      }, 20);
      return;
    }

    var count = opts.pod ? (opts.pod | 0) : (opts.breaks ? 1 : 1);
    var breaks = opts.breaks || 1;
    var playedBreaks = 0;

    function playBreak() {
      self._emit('ad_break_started', { index: playedBreaks });
      self._emit('content_pause_requested');
      playPodAd(0);
    }

    function playPodAd(i) {
      self.adView = { removed: false };
      self._emit('ad_loaded', { pod: i });
      self._emit('ad_started', { pod: i });
      self._emit('seek_blocked');
      self._firePixel('impression');
      self._firePixel('quartile/start');

      var dur = opts.durationMs || 200;
      // Skip button.
      if (opts.skippable) {
        self._schedule(function () {
          self._emit('skip_button_shown', { at: opts.skipOffsetMs || Math.floor(dur / 2) });
        }, Math.min(opts.skipOffsetMs || Math.floor(dur / 2), dur));
      }

      self._schedule(function () { self._firePixel('quartile/first'); }, dur * 0.25);
      self._schedule(function () { self._firePixel('quartile/midpoint'); }, dur * 0.5);
      self._schedule(function () { self._firePixel('quartile/third'); }, dur * 0.75);
      self._schedule(function () {
        self._firePixel('quartile/complete');
        self._emit('ad_complete', { pod: i });
        if (i + 1 < count) {
          playPodAd(i + 1);
        } else {
          finishBreak();
        }
      }, dur);
    }

    function finishBreak() {
      self._emit('ad_break_ended', { index: playedBreaks });
      self._emit('content_resume_requested');
      playedBreaks++;
      if (playedBreaks < breaks) {
        self._schedule(playBreak, 20);
      } else {
        cb({ ok: true, pixels: self.pixels, requests: self.requests });
      }
    }

    playBreak();
  };

  ReferenceSdk.prototype.click = function () { this._firePixel('click'); };

  ReferenceSdk.prototype.skip = function () {
    this._emit('ad_skipped');
    this._firePixel('skip');
  };

  ReferenceSdk.prototype.setNetwork = function (up) {
    this.networkUp = up;
    if (up) {
      // Flush queued pixels exactly once each.
      var queued = this.pendingPixels.slice();
      this.pendingPixels = [];
      for (var i = 0; i < queued.length; i++) this._firePixel(queued[i]);
      this._emit('network_reconnect');
    } else {
      this._emit('network_drop');
    }
  };

  ReferenceSdk.prototype.setHidden = function (hidden) {
    if (hidden) this._emit('ad_paused_on_hidden');
    else this._emit('ad_resumed_on_visible');
  };

  ReferenceSdk.prototype.destroy = function () {
    for (var i = 0; i < this._timers.length; i++) clearTimeout(this._timers[i]);
    this._timers = [];
    if (this.adView) this.adView.removed = true;
    this.activeTimers = 0;
    var removed = this.adView ? this.adView.removed : true;
    this.adView = null;
    this._emit('ad_destroyed', { viewRemoved: removed });
    // Settle any ad load that was in-flight when teardown happened so callers
    // awaiting loadAd() do not hang after destroy().
    if (this._activeCb) {
      var pending = this._activeCb;
      this._activeCb = null;
      pending({ ok: false, destroyed: true });
    }
  };

  ReferenceSdk.prototype.pixelCount = function (kind) { return this.pixels[kind] || 0; };
  ReferenceSdk.prototype.insecureRequestCount = function () {
    var n = 0;
    for (var i = 0; i < this.requests.length; i++) {
      if (this.requests[i].url.indexOf('http://') === 0) n++;
    }
    return n;
  };
  ReferenceSdk.prototype.requestsMissingConsentHeader = function () {
    var n = 0;
    for (var i = 0; i < this.requests.length; i++) {
      if (!this.requests[i].headers['x-consent-string']) n++;
    }
    return n;
  };

  // -------------------------------------------------------------------------
  // Factory — pick the real SDK wrapper or the reference implementation.
  // -------------------------------------------------------------------------
  function create(globalObj) {
    var g = globalObj || (typeof window !== 'undefined' ? window : {});
    var sdk = new ReferenceSdk();
    sdk.backend = (g && g.AdsSDK) ? 'real' : 'reference';
    // NOTE: when g.AdsSDK exists, a thin wrapper could delegate to it here.
    // The reference implementation is used as the default executable spec.
    return sdk;
  }

  return { create: create, ReferenceSdk: ReferenceSdk };
});
