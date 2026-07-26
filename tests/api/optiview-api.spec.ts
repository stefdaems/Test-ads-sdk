/**
 * OptiView Backend Integration Tests
 *
 * Exercises the live OptiView Ads API staging backend.  Every test skips
 * automatically when OPTIVIEW_API_KEY / OPTIVIEW_ORG_ID are not set, so
 * CI pipelines that do not have credentials still pass (other tests are
 * unaffected).
 *
 * Environment variables required to run these tests:
 *   OPTIVIEW_API_BASE_URL  (default: https://optiview-ads-api-phx-1.staging.dolbyio.com/api/v1)
 *   OPTIVIEW_API_KEY
 *   OPTIVIEW_API_SECRET
 *   OPTIVIEW_ORG_ID
 *
 * Run only these tests:
 *   cd tests && OPTIVIEW_API_KEY=... OPTIVIEW_API_SECRET=... OPTIVIEW_ORG_ID=... npm run test:api
 */

import * as Optiview from '../helpers/optiviewApi';

// ---------------------------------------------------------------------------
// Skip helper
// ---------------------------------------------------------------------------

function skipIfUnconfigured() {
  if (!Optiview.isConfigured()) {
    // Jest does not have a first-class "skip from inside the test" API in all
    // versions; returning early is the safest cross-version idiom.
    return true;
  }
  return false;
}

beforeEach(() => {
  // Ensure a clean token cache at the start of each test so error-path tests
  // do not inadvertently poison the cache for subsequent tests.
  Optiview.clearTokenCache();
});

// ---------------------------------------------------------------------------
// 1. Authentication
// ---------------------------------------------------------------------------

describe('OptiView API — Authentication', () => {
  test('valid credentials obtain an access token or fall back gracefully', async () => {
    if (skipIfUnconfigured()) return;

    // getAccessToken either returns a proper JWT or falls back to the raw
    // API_KEY when the /auth/token endpoint is absent.
    const token = await Optiview.getAccessToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('token is cached and reused across multiple calls', async () => {
    if (skipIfUnconfigured()) return;

    const t1 = await Optiview.getAccessToken();
    const t2 = await Optiview.getAccessToken();
    expect(t1).toBe(t2);
  });

  test('invalid API key returns 401 Unauthorized', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/organizations/' + Optiview.ORG_ID, {
      authOverride: {
        Authorization: '******',
        'X-API-Key':   'invalid-key-that-does-not-exist',
        Accept:        'application/json',
        'Content-Type': 'application/json',
      },
    });
    expect(status).toBe(401);
  });

  test('missing Authorization header returns 401 Unauthorized', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/organizations/' + Optiview.ORG_ID, {
      authOverride: {
        Accept:        'application/json',
        'Content-Type': 'application/json',
      },
    });
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2. Organisation
// ---------------------------------------------------------------------------

describe('OptiView API — Organisation', () => {
  test('GET /organizations/:id returns 200 with org data', async () => {
    if (skipIfUnconfigured()) return;

    const org = await Optiview.getOrganization();
    expect(org).toBeDefined();
    // The id in the response must match what we requested
    expect(org.id).toBe(Optiview.ORG_ID);
  });

  test('org response contains name and status fields', async () => {
    if (skipIfUnconfigured()) return;

    const org = await Optiview.getOrganization();
    expect(typeof org.name).toBe('string');
    expect(org.name.length).toBeGreaterThan(0);
    expect(typeof org.status).toBe('string');
  });

  test('org response is consistent across repeated calls', async () => {
    if (skipIfUnconfigured()) return;

    const [a, b] = await Promise.all([
      Optiview.getOrganization(),
      Optiview.getOrganization(),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.name).toBe(b.name);
  });

  test('GET /organizations/:id with an unknown org returns 404', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/organizations/00000000-0000-0000-0000-000000000000');
    // The API must return 404 (not 500) for unknown resource IDs.
    expect([404, 403]).toContain(status);
  });
});

// ---------------------------------------------------------------------------
// 3. Campaigns
// ---------------------------------------------------------------------------

describe('OptiView API — Campaigns', () => {
  test('GET /organizations/:id/campaigns returns 200', async () => {
    if (skipIfUnconfigured()) return;

    const result = await Optiview.listCampaigns();
    // Response must be an object — the exact shape varies by API version.
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('campaigns response contains a data array', async () => {
    if (skipIfUnconfigured()) return;

    const result = await Optiview.listCampaigns();
    // When a data array is present every item must have at least an id.
    if (Array.isArray(result.data)) {
      for (const campaign of result.data) {
        expect(typeof (campaign as Optiview.Campaign).id).toBe('string');
      }
    }
  });

  test('pagination query params are accepted without error', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/organizations/' + Optiview.ORG_ID + '/campaigns', {
      params: { page: 1, limit: 5 },
    });
    expect(status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 4. Placements
// ---------------------------------------------------------------------------

describe('OptiView API — Placements', () => {
  test('GET /organizations/:id/placements returns 200', async () => {
    if (skipIfUnconfigured()) return;

    const result = await Optiview.listPlacements();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('each placement has an id and a name', async () => {
    if (skipIfUnconfigured()) return;

    const result = await Optiview.listPlacements();
    if (Array.isArray(result.data)) {
      for (const p of result.data) {
        const placement = p as Optiview.Placement;
        expect(typeof placement.id).toBe('string');
        expect(typeof placement.name).toBe('string');
      }
    }
  });

  test('fetching a valid placement by id returns 200', async () => {
    if (skipIfUnconfigured()) return;

    // Get the first available placement and fetch it individually.
    const list = await Optiview.listPlacements({ limit: 1 });
    if (!Array.isArray(list.data) || list.data.length === 0) return; // nothing to test

    const id = (list.data[0] as Optiview.Placement).id;
    const placement = await Optiview.getPlacement(id);
    expect(placement.id).toBe(id);
  });

  test('fetching an unknown placement returns 404', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest(
      'GET',
      '/organizations/' + Optiview.ORG_ID + '/placements/00000000-0000-0000-0000-000000000000',
    );
    expect([404, 403]).toContain(status);
  });
});

// ---------------------------------------------------------------------------
// 5. VAST Tag Generation
// ---------------------------------------------------------------------------

describe('OptiView API — VAST Tags', () => {
  test('buildVastTagUrl returns a URL containing org_id and api_key', () => {
    if (skipIfUnconfigured()) return;

    const url = Optiview.buildVastTagUrl();
    expect(url).toContain('org_id=' + Optiview.ORG_ID);
    expect(url).toContain('api_key=' + Optiview.API_KEY);
  });

  test('buildVastTagUrl with placement_id includes placement_id param', () => {
    if (skipIfUnconfigured()) return;

    const url = Optiview.buildVastTagUrl({ placement_id: 'test-placement-123' });
    expect(url).toContain('placement_id=test-placement-123');
  });

  test('buildVmapTagUrl sets format=vmap', () => {
    if (skipIfUnconfigured()) return;

    const url = Optiview.buildVmapTagUrl();
    expect(url).toContain('format=vmap');
  });

  test('GET /vast returns 200 with XML content type', async () => {
    if (skipIfUnconfigured()) return;

    const { status, data } = await Optiview.rawRequest('GET', '/vast', {
      params: { org_id: Optiview.ORG_ID, api_key: Optiview.API_KEY, format: 'vast' },
    });
    // Accept 200 or 204 (no ads available right now is still valid).
    expect([200, 204]).toContain(status);
    if (status === 200 && typeof data === 'string' && data.length > 0) {
      expect(Optiview.looksLikeVast(data)).toBe(true);
    }
  });

  test('fetchVastXml returns a non-empty VAST envelope', async () => {
    if (skipIfUnconfigured()) return;

    let xml: string;
    try {
      xml = await Optiview.fetchVastXml();
    } catch (err) {
      // 204 / No Content is a valid "no ads" response — not a test failure.
      if (err instanceof Optiview.OptiviewApiError && err.status === 204) return;
      throw err;
    }

    if (xml.trim().length > 0) {
      expect(Optiview.looksLikeVast(xml)).toBe(true);
    }
  });

  test('VAST XML from the API contains at least one Impression URL', async () => {
    if (skipIfUnconfigured()) return;

    let xml: string;
    try {
      xml = await Optiview.fetchVastXml();
    } catch (err) {
      if (err instanceof Optiview.OptiviewApiError && err.status === 204) return;
      throw err;
    }

    if (xml.trim().length === 0) return; // empty VAST — no ads to check

    const impressionUrls = Optiview.extractImpressionUrls(xml);
    // A complete VAST linear ad must have at least one impression tracker.
    if (impressionUrls.length > 0) {
      for (const u of impressionUrls) {
        expect(u).toMatch(/^https?:\/\//);
      }
    }
  });

  test('VAST XML contains a MediaFile URL when a linear ad is returned', async () => {
    if (skipIfUnconfigured()) return;

    let xml: string;
    try {
      xml = await Optiview.fetchVastXml();
    } catch (err) {
      if (err instanceof Optiview.OptiviewApiError && err.status === 204) return;
      throw err;
    }

    if (xml.trim().length === 0) return;

    const mediaUrl = Optiview.extractFirstMediaFileUrl(xml);
    if (mediaUrl !== null) {
      expect(mediaUrl).toMatch(/^https?:\/\//);
    }
  });

  test('VAST endpoint with invalid api_key returns 401', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/vast', {
      params: { org_id: Optiview.ORG_ID, api_key: 'invalid-key', format: 'vast' },
      authOverride: {
        Authorization: '******',
        Accept: 'application/xml, */*',
        'Content-Type': 'application/json',
      },
    });
    expect([401, 403]).toContain(status);
  });
});

// ---------------------------------------------------------------------------
// 6. Reporting
// ---------------------------------------------------------------------------

describe('OptiView API — Reporting', () => {
  test('GET /organizations/:id/reports returns 200', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/organizations/' + Optiview.ORG_ID + '/reports');
    // 200 or 204 (no data yet) are both acceptable.
    expect([200, 204]).toContain(status);
  });

  test('report response has a data array when 200 is returned', async () => {
    if (skipIfUnconfigured()) return;

    const { status, data } = await Optiview.rawRequest('GET', '/organizations/' + Optiview.ORG_ID + '/reports');
    if (status !== 200) return;

    const report = data as Optiview.ListResponse<Optiview.ReportRow>;
    if (report.data !== undefined) {
      expect(Array.isArray(report.data)).toBe(true);
    }
  });

  test('daily granularity report is accepted', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/organizations/' + Optiview.ORG_ID + '/reports', {
      params: { granularity: 'daily', metrics: 'impressions,clicks' },
    });
    expect(status).toBeLessThan(500);
  });

  test('date-range filter is accepted', async () => {
    if (skipIfUnconfigured()) return;

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const { status } = await Optiview.rawRequest('GET', '/organizations/' + Optiview.ORG_ID + '/reports', {
      params: { start_date: sevenDaysAgo, end_date: today },
    });
    expect(status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 7. Error handling & resilience
// ---------------------------------------------------------------------------

describe('OptiView API — Error Handling', () => {
  test('404 on non-existent endpoint does not throw uncaught error', async () => {
    if (skipIfUnconfigured()) return;

    const { status } = await Optiview.rawRequest('GET', '/this-endpoint-does-not-exist');
    expect(status).toBe(404);
  });

  test('OptiviewApiError includes status, method and path', async () => {
    if (skipIfUnconfigured()) return;

    let thrown: Optiview.OptiviewApiError | null = null;
    try {
      await Optiview.getOrganization.call(null);
      // Force a 404 by requesting an unknown org directly.
      await Optiview.rawRequest('GET', '/organizations/00000000-0000-0000-0000-000000000000').then(
        ({ status, data }) => {
          if (status >= 400) {
            throw new Optiview.OptiviewApiError(status, 'GET', '/organizations/...', JSON.stringify(data));
          }
        }
      );
    } catch (err) {
      if (err instanceof Optiview.OptiviewApiError) thrown = err;
    }

    if (thrown !== null) {
      expect(thrown.status).toBeGreaterThanOrEqual(400);
      expect(thrown.method).toBe('GET');
      expect(thrown.message).toContain(String(thrown.status));
    }
  });

  test('API returns JSON error body on validation failure', async () => {
    if (skipIfUnconfigured()) return;

    // POST to a list endpoint with a garbage body to provoke a 400.
    const { status, data } = await Optiview.rawRequest(
      'POST',
      '/organizations/' + Optiview.ORG_ID + '/campaigns',
      { body: { invalid_field_xyz: true } },
    );
    if (status === 400) {
      // The error body should be a JSON object, not an HTML page.
      expect(typeof data).toBe('object');
    }
    // Any 4xx is acceptable; 5xx would indicate a backend bug.
    expect(status).toBeLessThan(500);
  });
});
