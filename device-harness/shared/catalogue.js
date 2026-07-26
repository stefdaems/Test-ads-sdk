/**
 * catalogue.js
 *
 * Canonical catalogue of every Ads SDK use-case the on-device test app can
 * execute. This single file is the source of truth shared by:
 *
 *   - the on-device test app  (loaded in the browser via <script>)
 *   - the external manager     (loaded in Node via require())
 *
 * Each entry describes one runnable scenario. The actual runner functions live
 * in the device app (device-harness/app/scenarios.js) keyed by the same `id`,
 * because they manipulate the DOM / drive the ads-sdk on the device.
 *
 * Keeping only metadata here (id / title / category / description) means the
 * manager and the device always agree on the catalogue without duplicating
 * execution logic.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdSdkCatalogue = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** @type {Array<{id:string,title:string,category:string,description:string}>} */
  var SCENARIOS = [
    // --- Initialization & configuration ------------------------------------
    {
      id: 'init_valid_pid',
      title: 'SDK init with valid Publisher ID',
      category: 'init',
      description: 'SDK initialises successfully and reports ready with a valid PID.',
    },
    {
      id: 'init_null_pid',
      title: 'SDK rejects null Publisher ID',
      category: 'init',
      description: 'Passing a null/empty PID fails gracefully without crashing the host.',
    },
    {
      id: 'init_double',
      title: 'Double init warns, no crash',
      category: 'init',
      description: 'Calling init twice logs already_initialized and does not duplicate requests.',
    },

    // --- Consent & privacy -------------------------------------------------
    {
      id: 'consent_granted_tracking',
      title: 'Consent granted — tracking fires',
      category: 'consent',
      description: 'With TCF/GDPR consent granted, the impression pixel fires and consent string is attached.',
    },
    {
      id: 'consent_denied_no_tracking',
      title: 'Consent denied — no tracking',
      category: 'consent',
      description: 'With consent denied, no impression/click pixels fire and consent_denied is logged.',
    },
    {
      id: 'ccpa_opt_out',
      title: 'CCPA opt-out suppresses sale tracking',
      category: 'consent',
      description: 'CCPA opt-out suppresses sale-related tracking on all requests.',
    },
    {
      id: 'att_prompt_ios',
      title: 'ATT prompt before first ad (iOS)',
      category: 'consent',
      description: 'On iOS the ATT authorisation is requested before the first ad request.',
    },

    // --- Ad scheduling / breaks -------------------------------------------
    {
      id: 'preroll',
      title: 'Pre-roll before content',
      category: 'scheduling',
      description: 'Pre-roll ad plays and completes before content starts; content pauses then resumes.',
    },
    {
      id: 'midroll',
      title: 'Mid-roll at time offset',
      category: 'scheduling',
      description: 'Mid-roll ad plays at the configured offset and content resumes at the correct position.',
    },
    {
      id: 'postroll',
      title: 'Post-roll after content',
      category: 'scheduling',
      description: 'Post-roll ad plays after content completes.',
    },
    {
      id: 'vmap_multi_break',
      title: 'VMAP multi-break scheduling',
      category: 'scheduling',
      description: 'A VMAP tag schedules pre/mid/post breaks automatically.',
    },
    {
      id: 'ad_pod',
      title: 'Ad pod sequential playback',
      category: 'scheduling',
      description: 'All ads in a pod play in order before content resumes.',
    },

    // --- Skip functionality -----------------------------------------------
    {
      id: 'skip_button_offset',
      title: 'Skip button appears at offset',
      category: 'skip',
      description: 'Skip button appears at the declared skip offset and fires the skip pixel when used.',
    },
    {
      id: 'non_skippable',
      title: 'Non-skippable — no skip button',
      category: 'skip',
      description: 'A non-skippable ad never exposes a skip button.',
    },

    // --- VAST compliance ---------------------------------------------------
    {
      id: 'vast_linear',
      title: 'VAST linear plays to completion',
      category: 'vast',
      description: 'A VAST linear ad parses and plays to completion.',
    },
    {
      id: 'vast_wrapper',
      title: 'VAST wrapper chain resolves',
      category: 'vast',
      description: 'A VAST wrapper chain resolves to an inline ad and plays.',
    },
    {
      id: 'vast_empty_fallback',
      title: 'Empty VAST — graceful fallback',
      category: 'vast',
      description: 'An empty VAST response causes a graceful error and content resumes.',
    },
    {
      id: 'vast_404_fallback',
      title: '404 VAST URL — graceful fallback',
      category: 'vast',
      description: 'A 404 on the VAST URL causes a graceful error and content resumes.',
    },

    // --- Tracking & telemetry ---------------------------------------------
    {
      id: 'impression_once',
      title: 'Impression pixel fires once',
      category: 'tracking',
      description: 'The impression pixel fires exactly once per ad.',
    },
    {
      id: 'click_once',
      title: 'Click pixel fires once',
      category: 'tracking',
      description: 'The click pixel fires exactly once when the ad is clicked.',
    },
    {
      id: 'quartiles_in_order',
      title: 'Quartile pixels fire in order',
      category: 'tracking',
      description: 'Quartile pixels fire at start, 25%, 50%, 75%, complete in order.',
    },
    {
      id: 'no_dup_after_network_drop',
      title: 'No duplicate pixels after network drop',
      category: 'tracking',
      description: 'After a network drop and reconnect, no duplicate pixels are fired.',
    },
    {
      id: 'all_https',
      title: 'All SDK requests use HTTPS',
      category: 'tracking',
      description: 'Every SDK network request uses HTTPS.',
    },
    {
      id: 'consent_header_present',
      title: 'Consent header on every request',
      category: 'tracking',
      description: 'Every SDK request carries the x-consent-string header when consent is present.',
    },

    // --- Viewability & rendering ------------------------------------------
    {
      id: 'ad_in_viewport',
      title: 'Ad container visible in viewport',
      category: 'viewability',
      description: 'The ad container is fully within the visible viewport while the ad plays.',
    },
    {
      id: 'no_overlay_blocking_click',
      title: 'No overlay blocking click target',
      category: 'viewability',
      description: 'No transparent overlay prevents click-through on the ad.',
    },
    {
      id: 'pause_on_background',
      title: 'Ad pauses on background/hidden',
      category: 'viewability',
      description: 'The ad pauses when the app/page is hidden and resumes without a false completion.',
    },

    // --- Memory & cleanup -------------------------------------------------
    {
      id: 'ad_view_removed',
      title: 'Ad view removed after complete',
      category: 'memory',
      description: 'The ad view/DOM is removed from its parent when the ad is closed.',
    },
    {
      id: 'memory_stable_10_cycles',
      title: 'Memory stable across 10 cycles',
      category: 'memory',
      description: 'Memory footprint stays stable across 10 sequential load/destroy cycles.',
    },
    {
      id: 'threads_released',
      title: 'Background threads released after destroy',
      category: 'memory',
      description: 'No SDK background timers/threads remain after destroy().',
    },
  ];

  var CATEGORIES = [
    { id: 'init', label: 'Initialization' },
    { id: 'consent', label: 'Consent & Privacy' },
    { id: 'scheduling', label: 'Ad Scheduling' },
    { id: 'skip', label: 'Skip' },
    { id: 'vast', label: 'VAST Compliance' },
    { id: 'tracking', label: 'Tracking & Telemetry' },
    { id: 'viewability', label: 'Viewability' },
    { id: 'memory', label: 'Memory & Cleanup' },
  ];

  function byId(id) {
    for (var i = 0; i < SCENARIOS.length; i++) {
      if (SCENARIOS[i].id === id) return SCENARIOS[i];
    }
    return null;
  }

  return {
    SCENARIOS: SCENARIOS,
    CATEGORIES: CATEGORIES,
    byId: byId,
  };
});
