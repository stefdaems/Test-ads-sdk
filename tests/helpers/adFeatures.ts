/**
 * adFeatures.ts
 *
 * Central catalogue of every Ads SDK feature that must be validated across
 * all supported video-player integrations.
 *
 * Imports:
 *   import { AdFeature, AD_EVENTS, VAST_FIXTURES } from '../helpers/adFeatures';
 */

// ---------------------------------------------------------------------------
// Player identifiers
// ---------------------------------------------------------------------------

export type WebPlayer    = 'theoplayer' | 'shaka' | 'videojs' | 'bitmovin';
export type NativePlayer = 'theoplayer' | 'exoplayer' | 'bitmovin';
export type AnyPlayer    = WebPlayer | NativePlayer;

// ---------------------------------------------------------------------------
// Ad types
// ---------------------------------------------------------------------------

export type AdType =
  | 'linear-preroll'
  | 'linear-midroll'
  | 'linear-postroll'
  | 'linear-skippable'
  | 'nonlinear-overlay'
  | 'companion'
  | 'pod'         // multiple ads in one break
  | 'vmap';       // multiple breaks from one tag

// ---------------------------------------------------------------------------
// Ad lifecycle events the SDK must emit
// ---------------------------------------------------------------------------

export const AD_EVENTS = {
  // Scheduling
  AD_BREAK_STARTED:  'adBreakStarted',
  AD_BREAK_ENDED:    'adBreakEnded',

  // Per-ad lifecycle
  AD_LOADED:         'adLoaded',
  AD_STARTED:        'adStarted',
  AD_IMPRESSION:     'adImpression',
  AD_FIRST_QUARTILE: 'adFirstQuartile',
  AD_MIDPOINT:       'adMidpoint',
  AD_THIRD_QUARTILE: 'adThirdQuartile',
  AD_COMPLETE:       'adComplete',
  AD_SKIPPED:        'adSkipped',
  AD_CLICKED:        'adClicked',
  AD_ERROR:          'adError',

  // Player interaction
  CONTENT_PAUSE_REQUESTED:  'contentPauseRequested',
  CONTENT_RESUME_REQUESTED: 'contentResumeRequested',

  // Companion
  COMPANION_LOADED: 'companionLoaded',

  // Cleanup
  AD_DESTROYED: 'adDestroyed',
} as const;

export type AdEventName = typeof AD_EVENTS[keyof typeof AD_EVENTS];

// ---------------------------------------------------------------------------
// Tracking pixel URL patterns
// ---------------------------------------------------------------------------

export const TRACKING_PATTERNS = {
  impression:  '/impression',
  click:       '/click',
  start:       '/quartile/start',
  firstQ:      '/quartile/first',
  midpoint:    '/quartile/midpoint',
  thirdQ:      '/quartile/third',
  complete:    '/quartile/complete',
  skip:        '/skip',
  error:       '/error',
} as const;

// ---------------------------------------------------------------------------
// VAST / VMAP fixture URLs — Google test tags (fallback)
//
// These point to stable public test-infrastructure endpoints.
// Replace with production test PIDs before running a final release check.
//
// When OPTIVIEW_API_KEY + OPTIVIEW_ORG_ID are set in the environment the
// helpers below will generate live VAST tags from the OptiView backend
// instead. Use getVastFixtures() in test files to pick up the right set
// automatically.
// ---------------------------------------------------------------------------

export const VAST_FIXTURES = {
  /** 15-second linear pre-roll */
  linear15s: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=',

  /** 30-second linear pre-roll */
  linear30s: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=',

  /** Skippable linear (skip offset = 5 s) */
  skippable: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dskippablelinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=',

  /** Non-linear overlay */
  nonLinear: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/nonlinear_ad_samples&sz=480x70&cust_params=sample_ct%3Dnonlinear&ciu_szs=300x250&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=',

  /** Ad pod — 3 ads in one break */
  pod3: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&ad_rule=1&pmad=3&correlator=',

  /** VMAP: pre/mid/post-roll breaks */
  vmap: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/vmap_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&ad_rule=1&output=vmap&unviewed_position_start=1&env=vp&impl=s&cmsid=496&vid=short_onecue&correlator=',

  /** VAST error — empty response */
  empty: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Demptyvast&correlator=',

  /** VAST wrapper chain (2 hops) */
  wrapper: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinearvpaid2js&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=',
} as const;

// ---------------------------------------------------------------------------
// OptiView live VAST fixtures
//
// Generated from the real OptiView backend when credentials are available.
// The URLs are self-authenticating (org_id + api_key as query params) so
// they can be passed directly to any video player.
// ---------------------------------------------------------------------------

const _OPTIVIEW_BASE  = process.env.OPTIVIEW_API_BASE_URL ?? 'https://optiview-ads-api-phx-1.staging.dolbyio.com/api/v1';
const _OPTIVIEW_KEY   = process.env.OPTIVIEW_API_KEY   ?? '';
const _OPTIVIEW_ORG   = process.env.OPTIVIEW_ORG_ID    ?? '';

function _optiviewVastUrl(extra: Record<string, string> = {}): string {
  const url = new URL(_OPTIVIEW_BASE + '/vast');
  url.searchParams.set('org_id',  _OPTIVIEW_ORG);
  url.searchParams.set('api_key', _OPTIVIEW_KEY);
  url.searchParams.set('format',  'vast');
  url.searchParams.set('sz',      '640x480');
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * VAST tag URLs backed by the live OptiView staging API.
 *
 * All keys mirror VAST_FIXTURES so they are drop-in replacements in test
 * files.  When OPTIVIEW_API_KEY / OPTIVIEW_ORG_ID are absent, these URLs
 * will still be syntactically valid but will return 401 from the backend.
 */
export const OPTIVIEW_VAST_FIXTURES = {
  linear15s:  _optiviewVastUrl({ ad_type: 'linear', duration: '15' }),
  linear30s:  _optiviewVastUrl({ ad_type: 'linear', duration: '30' }),
  skippable:  _optiviewVastUrl({ ad_type: 'skippable', skip_offset: '5' }),
  nonLinear:  _optiviewVastUrl({ ad_type: 'nonlinear' }),
  pod3:       _optiviewVastUrl({ ad_type: 'pod', pod_size: '3' }),
  vmap:       (() => {
    const url = new URL(_OPTIVIEW_BASE + '/vast');
    url.searchParams.set('org_id',  _OPTIVIEW_ORG);
    url.searchParams.set('api_key', _OPTIVIEW_KEY);
    url.searchParams.set('format',  'vmap');
    url.searchParams.set('sz',      '640x480');
    return url.toString();
  })(),
  empty:      _optiviewVastUrl({ ad_type: 'empty' }),
  wrapper:    _optiviewVastUrl({ ad_type: 'wrapper' }),
} as const;

/**
 * Returns OptiView live VAST fixtures when credentials are configured,
 * otherwise falls back to Google test fixtures.
 *
 * Use this in all player and network tests to automatically exercise the
 * real backend when credentials are available:
 *
 *   import { getVastFixtures } from '../helpers/adFeatures';
 *   const FIXTURES = getVastFixtures();
 */
export function getVastFixtures(): typeof VAST_FIXTURES | typeof OPTIVIEW_VAST_FIXTURES {
  if (_OPTIVIEW_KEY !== '' && _OPTIVIEW_ORG !== '') {
    return OPTIVIEW_VAST_FIXTURES;
  }
  return VAST_FIXTURES;
}

// ---------------------------------------------------------------------------
// Feature matrix — maps feature name → supported players
//
// This is the canonical truth about which players need to be exercised for
// each feature.  Test suites should skip features not listed for their player.
// ---------------------------------------------------------------------------

export interface FeatureEntry {
  description: string;
  webPlayers:    WebPlayer[];
  nativePlayers: NativePlayer[];
}

export const FEATURE_MATRIX: Record<string, FeatureEntry> = {
  // --- Initialization & Configuration ------------------------------------
  sdk_init_with_valid_pid: {
    description: 'SDK initialises successfully with a valid Publisher ID',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  sdk_init_player_adapter: {
    description: 'Player-specific adapter attaches without error',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  sdk_rejects_null_pid: {
    description: 'SDK rejects null / empty Publisher ID gracefully',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  sdk_double_init: {
    description: 'Calling init twice produces a warning, no crash, no duplicate requests',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },

  // --- Ad Scheduling / Breaks -------------------------------------------
  preroll_plays_before_content: {
    description: 'Pre-roll ad plays before content stream begins',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  midroll_plays_at_offset: {
    description: 'Mid-roll ad plays at the configured time offset',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  postroll_plays_after_content: {
    description: 'Post-roll ad plays after content completes',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  vmap_schedules_multiple_breaks: {
    description: 'VMAP tag schedules pre/mid/post breaks automatically',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  ad_pod_plays_sequentially: {
    description: 'Ad pod plays all ads in order before content resumes',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },

  // --- Skip Functionality -----------------------------------------------
  skip_button_appears_at_offset: {
    description: 'Skip button appears exactly at the declared skip offset',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  skip_fires_skip_pixel: {
    description: 'Skipping an ad fires the skip tracking pixel',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  non_skippable_ad_shows_no_skip_button: {
    description: 'Non-skippable ad exposes no skip button at any time',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },

  // --- VAST Compliance --------------------------------------------------
  vast_linear_plays: {
    description: 'VAST linear ad is parsed and plays correctly',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  vast_nonlinear_overlay: {
    description: 'VAST non-linear overlay renders over content without blocking playback',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'bitmovin'],
  },
  vast_companion_renders: {
    description: 'VAST companion ad renders in the designated slot',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: [],
  },
  vast_wrapper_resolves: {
    description: 'VAST wrapper chain resolves to inline ad and plays',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  vast_empty_graceful_fallback: {
    description: 'Empty VAST response causes graceful error; content resumes',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  vast_404_graceful_fallback: {
    description: '404 on VAST URL causes graceful error; content resumes',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },

  // --- Tracking & Telemetry ---------------------------------------------
  impression_pixel_fires_once: {
    description: 'Impression tracking pixel fires exactly once per ad',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  click_pixel_fires_once: {
    description: 'Click pixel fires exactly once when user clicks the ad',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  quartile_pixels_fire_in_order: {
    description: 'Quartile pixels fire at start, 25%, 50%, 75%, complete in order',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  no_duplicate_pixels_after_network_drop: {
    description: 'No duplicate pixels are fired after a network drop and reconnect',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  all_requests_use_https: {
    description: 'Every SDK network request uses HTTPS',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  consent_header_on_every_request: {
    description: 'Every SDK request carries the x-consent-string header',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },

  // --- Player Integration Contracts -------------------------------------
  content_pauses_for_preroll: {
    description: 'Content is paused while pre-roll is playing',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  content_resumes_after_ad: {
    description: 'Content resumes from the correct position after ad ends',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  seeking_disabled_during_ad: {
    description: 'Player seek bar is disabled / locked while an ad is playing',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  player_controls_hidden_during_ad: {
    description: 'Native player controls are replaced by SDK ad UI during ad playback',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  ad_fires_all_lifecycle_events: {
    description: 'SDK emits adLoaded → adStarted → adImpression → adComplete events',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },

  // --- Consent & Privacy ------------------------------------------------
  gdpr_tcf_string_passed_in_requests: {
    description: 'TCF v2 consent string is included in ad requests when consent is granted',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  no_tracking_on_gdpr_denied: {
    description: 'No tracking pixels fire when GDPR consent is denied',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  ccpa_opt_out_suppresses_sale_tracking: {
    description: 'CCPA opt-out suppresses sale-related tracking in all requests',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  att_prompt_before_ad_on_ios: {
    description: 'ATT authorisation dialog appears before first ad request on iOS',
    webPlayers:    [],
    nativePlayers: ['theoplayer', 'bitmovin'],
  },

  // --- Viewability ------------------------------------------------------
  ad_is_visible_in_viewport: {
    description: 'Ad container is fully within the visible viewport',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  no_overlay_blocking_click: {
    description: 'No transparent overlay prevents click-through on the ad',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  ad_pauses_on_app_background: {
    description: 'Ad video pauses when app/page is hidden; no false completion event fires',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },

  // --- Memory & Cleanup -------------------------------------------------
  ad_view_removed_after_close: {
    description: 'Ad DOM / view is removed from its parent when the ad is closed',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  no_memory_growth_after_10_cycles: {
    description: 'Memory footprint stays stable across 10 sequential ad load/destroy cycles',
    webPlayers:    ['theoplayer', 'shaka', 'videojs', 'bitmovin'],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
  background_threads_released_after_destroy: {
    description: 'No SDK background threads remain after destroy()',
    webPlayers:    [],
    nativePlayers: ['theoplayer', 'exoplayer', 'bitmovin'],
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers to check whether a feature applies to a given player
// ---------------------------------------------------------------------------

export function webPlayerSupports(player: WebPlayer, featureKey: keyof typeof FEATURE_MATRIX): boolean {
  return FEATURE_MATRIX[featureKey].webPlayers.includes(player);
}

export function nativePlayerSupports(player: NativePlayer, featureKey: keyof typeof FEATURE_MATRIX): boolean {
  return FEATURE_MATRIX[featureKey].nativePlayers.includes(player);
}
