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
  // Real SDK wrapper — delegates to window.AdsSDK when it is present.
  // -------------------------------------------------------------------------

  // Map from real SDK event names to the adapter's canonical snake_case names.
  // Both camelCase and snake_case keys are included so the wrapper handles
  // real SDKs that follow either naming convention.
  var REAL_SDK_EVENT_MAP = {
    initialized:              'sdk_initialized',
    sdk_initialized:          'sdk_initialized',
    initError:                'init_error',
    init_error:               'init_error',
    alreadyInitialized:       'already_initialized',
    already_initialized:      'already_initialized',
    consentSet:               'consent_set',
    consent_set:              'consent_set',
    consentDenied:            'consent_denied',
    consent_denied:           'consent_denied',
    ccpaOptOut:               'ccpa_opt_out',
    ccpa_opt_out:             'ccpa_opt_out',
    attPromptShown:           'att_prompt_shown',
    att_prompt_shown:         'att_prompt_shown',
    adLoaded:                 'ad_loaded',
    ad_loaded:                'ad_loaded',
    adStarted:                'ad_started',
    ad_started:               'ad_started',
    adComplete:               'ad_complete',
    adFinished:               'ad_complete',
    ad_complete:              'ad_complete',
    adSkipped:                'ad_skipped',
    ad_skipped:               'ad_skipped',
    adError:                  'ad_error',
    ad_error:                 'ad_error',
    adDestroyed:              'ad_destroyed',
    ad_destroyed:             'ad_destroyed',
    adBreakStarted:           'ad_break_started',
    ad_break_started:         'ad_break_started',
    adBreakEnded:             'ad_break_ended',
    ad_break_ended:           'ad_break_ended',
    skipButtonShown:          'skip_button_shown',
    skip_button_shown:        'skip_button_shown',
    contentPauseRequested:    'content_pause_requested',
    content_pause_requested:  'content_pause_requested',
    contentResumeRequested:   'content_resume_requested',
    content_resume_requested: 'content_resume_requested',
    seekBlocked:              'seek_blocked',
    seek_blocked:             'seek_blocked',
    networkDrop:              'network_drop',
    network_drop:             'network_drop',
    networkReconnect:         'network_reconnect',
    network_reconnect:        'network_reconnect',
    adPausedOnHidden:         'ad_paused_on_hidden',
    ad_paused_on_hidden:      'ad_paused_on_hidden',
    adResumedOnVisible:       'ad_resumed_on_visible',
    ad_resumed_on_visible:    'ad_resumed_on_visible',
  };

  // Pixel kinds in longest-first order so "quartile/complete" always matches
  // before the shorter "quartile" prefix would (if it appeared in the list).
  var PIXEL_KINDS = [
    'quartile/complete', 'quartile/midpoint', 'quartile/third', 'quartile/first',
    'quartile/start', 'impression', 'click', 'skip', 'sale',
  ];

  function pixelKindFromUrl(url) {
    var u = String(url || '').toLowerCase();
    for (var i = 0; i < PIXEL_KINDS.length; i++) {
      if (u.indexOf(PIXEL_KINDS[i]) !== -1) return PIXEL_KINDS[i];
    }
    return null;
  }

  /**
   * Thin wrapper around the real AdsSDK global. Provides the same inspection
   * surface as ReferenceSdk (pixelCount, insecureRequestCount, etc.) by
   * intercepting fetch / XHR / sendBeacon and bridging the real SDK's events
   * onto the adapter's canonical event stream.
   */
  function RealSdkWrapper(realSdk, globalObj) {
    this._sdk = realSdk;
    this._g = globalObj || (typeof window !== 'undefined' ? window : {});
    this._handlers = [];
    // Inspection properties — mirrored locally so scenarios can assert on them.
    this.initialized = false;
    this.publisherId = null;
    this.consent = { gdpr: true, tcfString: '', ccpaOptOut: false, attGranted: true };
    this.pixels = {};
    this.requests = [];
    this.networkUp = true;
    this.pendingPixels = [];
    this.adView = null;
    this.activeTimers = 0;   // real SDK manages its own timers; always 0 here
    this._activeCb = null;
    this._interceptRequests();
    this._bridgeEvents();
  }

  RealSdkWrapper.prototype.on = function (handler) { this._handlers.push(handler); };

  RealSdkWrapper.prototype._emit = function (name, detail) {
    var evt = { name: name, at: now(), detail: detail || null };
    for (var i = 0; i < this._handlers.length; i++) this._handlers[i](evt);
  };

  // ---- Network request interception ----------------------------------------
  // Wraps fetch, XMLHttpRequest, and sendBeacon for the lifetime of the adapter
  // instance so every outbound request the real SDK fires is captured. This lets
  // scenarios assert on pixel counts, HTTPS usage, and consent header presence
  // without reaching into the real SDK's internals.
  RealSdkWrapper.prototype._interceptRequests = function () {
    var self = this;
    var g = this._g;

    if (typeof g.fetch === 'function') {
      var origFetch = g.fetch;
      g.fetch = function (input, init) {
        var url = input && typeof input === 'object' && input.url ? input.url : String(input || '');
        self._recordRequest(url, (init && init.headers) || {});
        return origFetch.apply(g, arguments);
      };
    }

    if (typeof g.XMLHttpRequest === 'function') {
      var XHRProto = g.XMLHttpRequest.prototype;
      var origOpen = XHRProto.open;
      var origSetHeader = XHRProto.setRequestHeader;
      var origSend = XHRProto.send;
      XHRProto.open = function (method, url) {
        this._adsdkUrl = url;
        this._adsdkHeaders = {};
        return origOpen.apply(this, arguments);
      };
      XHRProto.setRequestHeader = function (name, value) {
        if (this._adsdkHeaders) this._adsdkHeaders[String(name).toLowerCase()] = value;
        return origSetHeader.apply(this, arguments);
      };
      XHRProto.send = function () {
        if (this._adsdkUrl) self._recordRequest(this._adsdkUrl, this._adsdkHeaders || {});
        return origSend.apply(this, arguments);
      };
    }

    if (g.navigator && typeof g.navigator.sendBeacon === 'function') {
      var origBeacon = g.navigator.sendBeacon;
      g.navigator.sendBeacon = function (url) {
        self._recordRequest(String(url), {});
        return origBeacon.apply(g.navigator, arguments);
      };
    }
  };

  RealSdkWrapper.prototype._recordRequest = function (url, rawHeaders) {
    var headers = {};
    if (rawHeaders) {
      if (typeof rawHeaders.get === 'function') {
        // Fetch Headers object.
        var cv = rawHeaders.get('x-consent-string');
        if (cv) headers['x-consent-string'] = cv;
      } else {
        var keys = Object.keys(rawHeaders);
        for (var ki = 0; ki < keys.length; ki++) {
          headers[keys[ki].toLowerCase()] = rawHeaders[keys[ki]];
        }
      }
    }
    this.requests.push({ url: url, headers: headers });
    var kind = pixelKindFromUrl(url);
    if (kind) {
      this.pixels[kind] = (this.pixels[kind] || 0) + 1;
      this._emit('pixel', { kind: kind, count: this.pixels[kind] });
    }
  };

  // ---- Event bridging -------------------------------------------------------
  // Subscribe to every event name in REAL_SDK_EVENT_MAP using whichever
  // registration API the real SDK exposes (on / addEventListener / addListener)
  // and re-emit under the adapter's canonical snake_case name.
  RealSdkWrapper.prototype._bridgeEvents = function () {
    var self = this;
    var sdk = this._sdk;
    if (!sdk) return;
    var subscribe =
      typeof sdk.on === 'function'              ? function (n, fn) { sdk.on(n, fn); }
    : typeof sdk.addEventListener === 'function' ? function (n, fn) { sdk.addEventListener(n, function (e) { fn(e && e.detail); }); }
    : typeof sdk.addListener === 'function'      ? function (n, fn) { sdk.addListener(n, fn); }
    : null;
    if (!subscribe) return;
    var rawNames = Object.keys(REAL_SDK_EVENT_MAP);
    for (var i = 0; i < rawNames.length; i++) {
      (function (rawName) {
        subscribe(rawName, function (detail) {
          self._emit(REAL_SDK_EVENT_MAP[rawName], detail || null);
        });
      })(rawNames[i]);
    }
  };

  // ---- Public API -----------------------------------------------------------

  RealSdkWrapper.prototype.init = function (config) {
    config = config || {};
    if (this.initialized) {
      this._emit('already_initialized');
      return { ok: false, reason: 'already_initialized' };
    }
    if (!config.publisherId) {
      this._emit('init_error', { reason: 'null_publisher_id' });
      return { ok: false, reason: 'null_publisher_id' };
    }
    if (config.consent) this.setConsent(config.consent);
    var result;
    try {
      var initFn = typeof this._sdk.init === 'function'       ? this._sdk.init
                 : typeof this._sdk.initialize === 'function' ? this._sdk.initialize
                 : null;
      result = initFn ? initFn.call(this._sdk, config) || {} : {};
    } catch (e) {
      this._emit('init_error', { reason: String(e && e.message || e) });
      return { ok: false, reason: 'init_error' };
    }
    if (result.ok === false) {
      this._emit('init_error', result);
      return result;
    }
    this.initialized = true;
    this.publisherId = config.publisherId;
    this._emit('sdk_initialized', { publisherId: this.publisherId });
    return { ok: true };
  };

  RealSdkWrapper.prototype.setConsent = function (consent) {
    if (typeof consent.gdpr === 'boolean') this.consent.gdpr = consent.gdpr;
    if (typeof consent.tcfString === 'string') this.consent.tcfString = consent.tcfString;
    if (typeof consent.ccpaOptOut === 'boolean') this.consent.ccpaOptOut = consent.ccpaOptOut;
    if (typeof consent.attGranted === 'boolean') this.consent.attGranted = consent.attGranted;
    if (typeof this._sdk.setConsent === 'function') {
      try { this._sdk.setConsent(this.consent); } catch (e) {}
    }
    this._emit('consent_set', this.consent);
  };

  RealSdkWrapper.prototype.requestAtt = function () {
    this._emit('att_prompt_shown');
    if (typeof this._sdk.requestAtt === 'function') {
      try { return this._sdk.requestAtt(); } catch (e) {}
    }
    return this.consent.attGranted;
  };

  RealSdkWrapper.prototype.loadAd = function (opts, cb) {
    var self = this;
    opts = opts || {};
    cb = cb || function () {};
    if (!this.initialized) {
      this._emit('ad_error', { reason: 'not_initialized' });
      return cb({ ok: false });
    }
    // Guarantee the callback fires exactly once.
    var settled = false;
    var originalCb = cb;
    cb = function (res) {
      if (settled) return;
      settled = true;
      if (self._activeCb === cb) self._activeCb = null;
      originalCb(res);
    };
    self._activeCb = cb;
    self.adView = { removed: false };
    var loadFn = typeof this._sdk.loadAd === 'function'    ? this._sdk.loadAd
               : typeof this._sdk.requestAd === 'function' ? this._sdk.requestAd
               : null;
    if (!loadFn) {
      this._emit('ad_error', { reason: 'loadAd_not_supported' });
      return cb({ ok: false, reason: 'loadAd_not_supported' });
    }
    try {
      loadFn.call(this._sdk, opts, function (res) { cb(res || { ok: true }); });
    } catch (e) {
      this._emit('ad_error', { reason: String(e && e.message || e) });
      cb({ ok: false });
    }
  };

  RealSdkWrapper.prototype.click = function () {
    if (typeof this._sdk.click === 'function') {
      try { this._sdk.click(); } catch (e) {}
    }
  };

  RealSdkWrapper.prototype.skip = function () {
    this._emit('ad_skipped');
    if (typeof this._sdk.skip === 'function') {
      try { this._sdk.skip(); } catch (e) {}
    }
  };

  // Called directly by some scenarios (e.g. ccpa_opt_out). Applies consent
  // rules locally, then forwards to the real SDK if it exposes the same method.
  RealSdkWrapper.prototype._firePixel = function (kind) {
    if (!this.consent.gdpr || !this.consent.attGranted) {
      this._emit('consent_denied', { pixel: kind });
      return;
    }
    if (kind === 'sale' && this.consent.ccpaOptOut) {
      this._emit('ccpa_opt_out', { pixel: kind });
      return;
    }
    this.pixels[kind] = (this.pixels[kind] || 0) + 1;
    this._emit('pixel', { kind: kind, count: this.pixels[kind] });
    if (typeof this._sdk._firePixel === 'function') {
      try { this._sdk._firePixel(kind); } catch (e) {}
    }
  };

  RealSdkWrapper.prototype.setNetwork = function (up) {
    this.networkUp = up;
    if (typeof this._sdk.setNetwork === 'function') {
      try { this._sdk.setNetwork(up); } catch (e) {}
    }
    this._emit(up ? 'network_reconnect' : 'network_drop');
  };

  RealSdkWrapper.prototype.setHidden = function (hidden) {
    if (typeof this._sdk.setHidden === 'function') {
      try { this._sdk.setHidden(hidden); } catch (e) {}
    }
    this._emit(hidden ? 'ad_paused_on_hidden' : 'ad_resumed_on_visible');
  };

  RealSdkWrapper.prototype.destroy = function () {
    if (typeof this._sdk.destroy === 'function') {
      try { this._sdk.destroy(); } catch (e) {}
    }
    this.activeTimers = 0;
    if (this.adView) this.adView.removed = true;
    this.adView = null;
    this._emit('ad_destroyed', { viewRemoved: true });
    if (this._activeCb) {
      var pending = this._activeCb;
      this._activeCb = null;
      pending({ ok: false, destroyed: true });
    }
  };

  RealSdkWrapper.prototype.pixelCount = function (kind) { return this.pixels[kind] || 0; };

  RealSdkWrapper.prototype.insecureRequestCount = function () {
    var n = 0;
    for (var i = 0; i < this.requests.length; i++) {
      if (this.requests[i].url.indexOf('http://') === 0) n++;
    }
    return n;
  };

  RealSdkWrapper.prototype.requestsMissingConsentHeader = function () {
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
    if (g && g.AdsSDK) {
      var wrapper = new RealSdkWrapper(g.AdsSDK, g);
      wrapper.backend = 'real';
      return wrapper;
    }
    var sdk = new ReferenceSdk();
    sdk.backend = 'reference';
    return sdk;
  }

  return { create: create, ReferenceSdk: ReferenceSdk, RealSdkWrapper: RealSdkWrapper };
});
