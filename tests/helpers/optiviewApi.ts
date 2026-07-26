/**
 * optiviewApi.ts
 *
 * Typed REST client for the OptiView Ads API backend.
 *
 * All public helpers throw a descriptive {@link OptiviewApiError} on
 * non-2xx responses so test assertions stay focused on behaviour rather
 * than HTTP plumbing.
 *
 * Environment variables (all optional; tests skip gracefully when absent):
 *   OPTIVIEW_API_BASE_URL  - base URL  (default: https://optiview-ads-api-phx-1.staging.dolbyio.com/api/v1)
 *   OPTIVIEW_API_KEY       - API key used as the client identifier
 *   OPTIVIEW_API_SECRET    - API secret used alongside the key for authentication
 *   OPTIVIEW_ORG_ID        - organisation UUID scoped to every org-level request
 *
 * Usage:
 *   import * as Optiview from '../helpers/optiviewApi';
 *
 *   if (!Optiview.isConfigured()) { return; }  // skip in CI without creds
 *   const org = await Optiview.getOrganization();
 */

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const BASE_URL   = process.env.OPTIVIEW_API_BASE_URL ?? 'https://optiview-ads-api-phx-1.staging.dolbyio.com/api/v1';
export const API_KEY    = process.env.OPTIVIEW_API_KEY    ?? '';
export const API_SECRET = process.env.OPTIVIEW_API_SECRET ?? '';
export const ORG_ID     = process.env.OPTIVIEW_ORG_ID     ?? '';

/** Returns true when all required credentials are present in the environment. */
export function isConfigured(): boolean {
  return API_KEY !== '' && ORG_ID !== '';
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type:   string;
  expires_in:   number;
}

export interface Organization {
  id:          string;
  name:        string;
  status:      string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Placement {
  id:          string;
  name:        string;
  type:        string;
  status:      string;
  vast_url?:   string;
  created_at?: string;
  [key: string]: unknown;
}

export interface Campaign {
  id:          string;
  name:        string;
  status:      string;
  start_date?: string;
  end_date?:   string;
  [key: string]: unknown;
}

export interface ReportRow {
  date?:        string;
  impressions?: number;
  clicks?:      number;
  quartiles?:   Record<string, number>;
  [key: string]: unknown;
}

export interface ListResponse<T> {
  data:   T[];
  total?: number;
  page?:  number;
  [key: string]: unknown;
}

export type VastFormat = 'vast' | 'vmap' | 'vast4';

export interface VastTagOptions {
  placement_id?: string;
  campaign_id?:  string;
  format?:       VastFormat;
  width?:        number;
  height?:       number;
  correlator?:   number;
  [key: string]: string | number | undefined;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class OptiviewApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path:   string,
    body:                   string,
  ) {
    super('OptiView API ' + method + ' ' + path + ' -> ' + status + ': ' + body);
    this.name = 'OptiviewApiError';
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Cached token — re-used within a test run to avoid repeated round-trips. */
let _cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Returns an access token obtained via the client-credentials OAuth2 flow
 * (POST /auth/token).  The token is cached until it is within 60 s of expiry.
 *
 * Falls back to returning API_KEY directly if the token endpoint is absent
 * (the API may accept the key as a bearer token for simpler integrations).
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) {
    return _cachedToken.token;
  }

  const response = await fetch(BASE_URL + '/auth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     API_KEY,
      client_secret: API_SECRET,
    }),
  });

  // If the token endpoint does not exist (404 / 405) fall back to using
  // the API_KEY directly as a bearer token.
  if (response.status === 404 || response.status === 405) {
    return API_KEY;
  }

  if (!response.ok) {
    throw new OptiviewApiError(response.status, 'POST', '/auth/token', await response.text());
  }

  const body = (await response.json()) as TokenResponse;
  _cachedToken = {
    token:     body.access_token,
    expiresAt: now + body.expires_in * 1_000,
  };
  return _cachedToken.token;
}

/** Clears the cached token (useful between test files that test auth paths). */
export function clearTokenCache(): void {
  _cachedToken = null;
}

// ---------------------------------------------------------------------------
// HTTP primitives
// ---------------------------------------------------------------------------

async function buildHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + token,
    'X-API-Key':   API_KEY,
    Accept:        'application/json',
    'Content-Type': 'application/json',
  };
  if (API_SECRET) {
    headers['X-API-Secret'] = API_SECRET;
  }
  if (ORG_ID) {
    headers['X-Org-ID'] = ORG_ID;
  }
  return headers;
}

/**
 * Raw HTTP request helper.
 * Returns { status, data, ok } without throwing so callers can assert on
 * error responses in tests that intentionally trigger them.
 */
export async function rawRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path:   string,
  opts: {
    body?:   unknown;
    params?: Record<string, string | number | undefined>;
    /** Override Authorization headers — used to test invalid-credential paths. */
    authOverride?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: unknown; ok: boolean }> {
  const url = new URL(BASE_URL + path);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers = opts.authOverride ?? await buildHeaders();
  const init: RequestInit = { method, headers: headers as Record<string, string> };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }

  const response = await fetch(url.toString(), init);
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, ok: response.ok };
}

/** Throws OptiviewApiError on non-2xx; otherwise returns parsed body. */
async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path:   string,
  opts: Parameters<typeof rawRequest>[2] = {},
): Promise<T> {
  const { status, data, ok } = await rawRequest(method, path, opts);
  if (!ok) {
    throw new OptiviewApiError(status, method, path, JSON.stringify(data));
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

/** Fetches the organisation record for OPTIVIEW_ORG_ID. */
export async function getOrganization(): Promise<Organization> {
  return apiRequest<Organization>('GET', '/organizations/' + ORG_ID);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/** Lists campaigns belonging to the organisation. */
export async function listCampaigns(
  params?: Record<string, string | number | undefined>,
): Promise<ListResponse<Campaign>> {
  return apiRequest<ListResponse<Campaign>>('GET', '/organizations/' + ORG_ID + '/campaigns', { params });
}

/** Fetches a single campaign by ID. */
export async function getCampaign(campaignId: string): Promise<Campaign> {
  return apiRequest<Campaign>('GET', '/organizations/' + ORG_ID + '/campaigns/' + campaignId);
}

// ---------------------------------------------------------------------------
// Placements / Ad units
// ---------------------------------------------------------------------------

/** Lists placements (ad units) belonging to the organisation. */
export async function listPlacements(
  params?: Record<string, string | number | undefined>,
): Promise<ListResponse<Placement>> {
  return apiRequest<ListResponse<Placement>>('GET', '/organizations/' + ORG_ID + '/placements', { params });
}

/** Fetches a single placement by ID. */
export async function getPlacement(placementId: string): Promise<Placement> {
  return apiRequest<Placement>('GET', '/organizations/' + ORG_ID + '/placements/' + placementId);
}

// ---------------------------------------------------------------------------
// VAST tags
// ---------------------------------------------------------------------------

/**
 * Returns a VAST/VMAP tag URL served by the OptiView backend.
 * The URL is self-authenticating via api_key query param and can be dropped
 * directly into any player VAST tag configuration.
 */
export function buildVastTagUrl(options: VastTagOptions = {}): string {
  const url = new URL(BASE_URL + '/vast');
  url.searchParams.set('org_id',  ORG_ID);
  url.searchParams.set('api_key', API_KEY);

  const { format = 'vast', width = 640, height = 480, correlator, ...rest } = options;
  url.searchParams.set('format', format);
  url.searchParams.set('sz', width + 'x' + height);
  if (correlator !== undefined) url.searchParams.set('correlator', String(correlator));

  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Fetches a VAST tag from the backend and returns the raw XML string.
 * Use this to verify the response is valid VAST before handing the URL to a player.
 */
export async function fetchVastXml(options: VastTagOptions = {}): Promise<string> {
  const url = buildVastTagUrl(options);
  const token = await getAccessToken();
  const response = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/xml, text/xml, */*',
    },
  });
  if (!response.ok) {
    throw new OptiviewApiError(response.status, 'GET', '/vast', await response.text());
  }
  return response.text();
}

/** Builds a VMAP tag URL for multi-break scheduling tests. */
export function buildVmapTagUrl(options: Omit<VastTagOptions, 'format'> = {}): string {
  return buildVastTagUrl({ ...options, format: 'vmap' });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface ReportParams {
  start_date?:   string;
  end_date?:     string;
  granularity?:  'hourly' | 'daily' | 'weekly';
  campaign_id?:  string;
  placement_id?: string;
  metrics?:      string;
}

/** Fetches an aggregated report for the organisation. */
export async function getReport(params?: ReportParams): Promise<ListResponse<ReportRow>> {
  return apiRequest<ListResponse<ReportRow>>(
    'GET',
    '/organizations/' + ORG_ID + '/reports',
    { params: params as Record<string, string | number | undefined> },
  );
}

// ---------------------------------------------------------------------------
// VAST XML helpers (used in test assertions)
// ---------------------------------------------------------------------------

/**
 * Minimal validation: checks that xml looks like a VAST or VMAP envelope.
 * Does NOT do full schema validation.
 */
export function looksLikeVast(xml: string): boolean {
  const trimmed = xml.trim();
  return (
    trimmed.startsWith('<VAST') ||
    trimmed.startsWith('<?xml') ||
    trimmed.includes('<VAST ') ||
    trimmed.includes('<vmap:VMAP')
  );
}

/** Extracts all Impression URLs from a VAST XML string. */
export function extractImpressionUrls(xml: string): string[] {
  const matches = [...xml.matchAll(/<Impression[^>]*><!\[CDATA\[([^\]]+)\]\]><\/Impression>/gi)];
  return matches.map((m) => m[1].trim());
}

/** Extracts the first MediaFile URL from a VAST XML string, or null. */
export function extractFirstMediaFileUrl(xml: string): string | null {
  const match = xml.match(/<MediaFile[^>]*><!\[CDATA\[([^\]]+)\]\]><\/MediaFile>/i);
  return match ? match[1].trim() : null;
}
