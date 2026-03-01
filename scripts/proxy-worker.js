/**
 * Cloudflare Worker Proxy for GA4 Data API
 *
 * This Worker acts as a secure proxy between the GitHub Pages dashboard
 * and the Google Analytics 4 Data API, keeping credentials hidden.
 *
 * Secrets (set via `wrangler secret put`):
 * - GA4_CREDENTIALS: Google service account JSON
 * - GA4_MEASUREMENT_ID: GA4 measurement ID (e.g., G-XXXXXXXXXX)
 *
 * Environment Variables (set in wrangler.toml):
 * - ALLOWED_ORIGINS: Comma-separated list of allowed CORS origins
 * - CACHE_TTL: Cache time-to-live in seconds
 */

// CORS preflight handler
function handleOptions(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowedOrigins = (ALLOWED_ORIGINS || '').split(',').map(o => o.trim());

  if (origin && allowedOrigins.includes(origin)) {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

// Main request handler
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS handling
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }

  const origin = request.headers.get('Origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  try {
    // Route handling
    if (path === '/api/analytics/summary') {
      return await getAnalyticsSummary(request, env, ctx, corsHeaders);
    } else if (path === '/api/analytics/projects') {
      return await getProjectAnalytics(request, env, ctx, corsHeaders);
    } else if (path === '/api/analytics/realtime') {
      return await getRealtimeAnalytics(request, env, ctx, corsHeaders);
    } else if (path === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: corsHeaders
      });
    } else {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: corsHeaders
      });
    }
  } catch (error) {
    console.error('Request error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

// Get aggregated analytics summary
async function getAnalyticsSummary(request, env, ctx, corsHeaders) {
  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate') || '7daysAgo';
  const endDate = url.searchParams.get('endDate') || 'today';

  // Get cached data if available
  const cacheKey = `analytics:summary:${startDate}:${endDate}`;
  const cache = caches.default;
  let cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  // Get GA4 credentials
  const credentials = await getGA4Credentials(env);
  const measurementId = env.GA4_MEASUREMENT_ID;

  if (!credentials || !measurementId) {
    return new Response(JSON.stringify({ error: 'GA4 credentials not configured' }), {
      status: 503,
      headers: corsHeaders
    });
  }

  // Query GA4 Data API
  const ga4Data = await queryGA4Data(credentials, measurementId, startDate, endDate);

  // Format response
  const response = {
    success: true,
    data: {
      summary: {
        totalUsers: ga4Data.totalUsers || 0,
        totalScreenPageViews: ga4Data.totalPageViews || 0,
        totalSessions: ga4Data.totalSessions || 0,
        averageSessionDuration: ga4Data.avgSessionDuration || 0,
        engagementRate: ga4Data.engagementRate || 0
      },
      byCountry: ga4Data.byCountry || [],
      byDevice: ga4Data.byDevice || [],
      bySource: ga4Data.bySource || [],
      overTime: ga4Data.overTime || []
    },
    metadata: {
      startDate,
      endDate,
      generatedAt: new Date().toISOString()
    }
  };

  // Cache the response
  const responseBody = JSON.stringify(response);
  const responseToCache = new Response(responseBody, {
    headers: {
      ...corsHeaders,
      'Cache-Control': `public, max-age=${env.CACHE_TTL || 300}`
    }
  });

  ctx.waitUntil(cache.put(request, responseToCache.clone()));

  return responseToCache;
}

// Get per-project analytics
async function getProjectAnalytics(request, env, ctx, corsHeaders) {
  const url = new URL(request.url);
  const projectKey = url.searchParams.get('project');
  const startDate = url.searchParams.get('startDate') || '30daysAgo';
  const endDate = url.searchParams.get('endDate') || 'today';

  if (!projectKey) {
    return new Response(JSON.stringify({ error: 'Missing project parameter' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const credentials = await getGA4Credentials(env);
  const measurementId = env.GA4_MEASUREMENT_ID;

  if (!credentials || !measurementId) {
    return new Response(JSON.stringify({ error: 'GA4 credentials not configured' }), {
      status: 503,
      headers: corsHeaders
    });
  }

  // Query GA4 with project_key filter
  const ga4Data = await queryGA4DataForProject(credentials, measurementId, projectKey, startDate, endDate);

  const response = {
    success: true,
    data: {
      projectKey,
      metrics: ga4Data
    },
    metadata: {
      startDate,
      endDate,
      generatedAt: new Date().toISOString()
    }
  };

  return new Response(JSON.stringify(response), { headers: corsHeaders });
}

// Get realtime user count
async function getRealtimeAnalytics(request, env, ctx, corsHeaders) {
  const credentials = await getGA4Credentials(env);
  const measurementId = env.GA4_MEASUREMENT_ID;

  if (!credentials || !measurementId) {
    return new Response(JSON.stringify({ error: 'GA4 credentials not configured' }), {
      status: 503,
      headers: corsHeaders
    });
  }

  // Query GA4 Realtime API
  const realtimeData = await queryGA4Realtime(credentials, measurementId);

  const response = {
    success: true,
    data: {
      activeUsers: realtimeData.activeUsers || 0
    },
    metadata: {
      generatedAt: new Date().toISOString()
    }
  };

  return new Response(JSON.stringify(response), { headers: corsHeaders });
}

// Get GA4 credentials from secret
async function getGA4Credentials(env) {
  try {
    const credentialsJson = env.GA4_CREDENTIALS;
    if (!credentialsJson) return null;
    return typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;
  } catch (e) {
    console.error('Failed to parse GA4 credentials:', e);
    return null;
  }
}

// Get Google OAuth token using service account
async function getGoogleOAuthToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  // Sign JWT (would need crypto library in production)
  // For now, this is a placeholder for the actual implementation

  // Exchange for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: 'SIGNED_JWT_PLACEHOLDER'
    })
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Query GA4 Data API
async function queryGA4Data(credentials, measurementId, startDate, endDate) {
  // Extract property ID from measurement ID
  const propertyId = measurementId.replace('G-', '');

  const accessToken = await getGoogleOAuthToken(credentials);

  const requestBody = {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' }
    ],
    dimensions: [
      { name: 'country' },
      { name: 'deviceCategory' },
      { name: 'sessionDefaultChannelGrouping' }
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'measurementId',
        stringFilter: { matchType: 'EXACT', value: measurementId }
      }
    }
  };

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`GA4 API error: ${response.statusText}`);
  }

  const data = await response.json();

  // Parse and format response
  return parseGA4Response(data);
}

// Query GA4 for specific project
async function queryGA4DataForProject(credentials, measurementId, projectKey, startDate, endDate) {
  const propertyId = measurementId.replace('G-', '');
  const accessToken = await getGoogleOAuthToken(credentials);

  const requestBody = {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'engagementRate' }
    ],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: 'measurementId',
              stringFilter: { matchType: 'EXACT', value: measurementId }
            }
          },
          {
            filter: {
              fieldName: 'customEvent:project_key',
              stringFilter: { matchType: 'EXACT', value: projectKey }
            }
          }
        ]
      }
    }
  };

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`GA4 API error: ${response.statusText}`);
  }

  const data = await response.json();
  return parseGA4Response(data);
}

// Query GA4 Realtime API
async function queryGA4Realtime(credentials, measurementId) {
  const propertyId = measurementId.replace('G-', '');
  const accessToken = await getGoogleOAuthToken(credentials);

  const requestBody = {
    metrics: [{ name: 'activeUsers' }]
  };

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`GA4 Realtime API error: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    activeUsers: parseInt(data.rows?.[0]?.metricValues?.[0]?.value) || 0
  };
}

// Parse GA4 API response
function parseGA4Response(data) {
  const result = {
    totalUsers: 0,
    totalPageViews: 0,
    totalSessions: 0,
    avgSessionDuration: 0,
    engagementRate: 0,
    byCountry: [],
    byDevice: [],
    bySource: [],
    overTime: []
  };

  if (!data.rows || data.rows.length === 0) {
    return result;
  }

  // Extract data from rows
  const metricNames = data.metricHeaders?.map(h => h.name) || [];
  const dimensionNames = data.dimensionHeaders?.map(h => h.name) || [];

  for (const row of data.rows) {
    const metrics = row.metricValues || [];
    const dimensions = row.dimensionValues || [];

    // Aggregate metrics
    metricNames.forEach((name, i) => {
      const value = parseInt(metrics[i]?.value) || 0;
      if (name === 'activeUsers') result.totalUsers += value;
      if (name === 'screenPageViews') result.totalPageViews += value;
      if (name === 'sessions') result.totalSessions += value;
    });

    // Group by dimensions
    const country = dimensions.find((_, i) => dimensionNames[i] === 'country')?.value || 'Unknown';
    const device = dimensions.find((_, i) => dimensionNames[i] === 'deviceCategory')?.value || 'Unknown';
    const source = dimensions.find((_, i) => dimensionNames[i] === 'sessionDefaultChannelGrouping')?.value || 'Unknown';

    // Aggregate by country
    let countryEntry = result.byCountry.find(c => c.country === country);
    if (!countryEntry) {
      countryEntry = { country, users: 0 };
      result.byCountry.push(countryEntry);
    }
    countryEntry.users += parseInt(metrics.find((_, i) => metricNames[i] === 'activeUsers')?.value) || 0;

    // Aggregate by device
    let deviceEntry = result.byDevice.find(d => d.device === device);
    if (!deviceEntry) {
      deviceEntry = { device, users: 0 };
      result.byDevice.push(deviceEntry);
    }
    deviceEntry.users += parseInt(metrics.find((_, i) => metricNames[i] === 'activeUsers')?.value) || 0;

    // Aggregate by source
    let sourceEntry = result.bySource.find(s => s.source === source);
    if (!sourceEntry) {
      sourceEntry = { source, sessions: 0 };
      result.bySource.push(sourceEntry);
    }
    sourceEntry.sessions += parseInt(metrics.find((_, i) => metricNames[i] === 'sessions')?.value) || 0;
  }

  // Sort arrays
  result.byCountry.sort((a, b) => b.users - a.users);
  result.byDevice.sort((a, b) => b.users - a.users);
  result.bySource.sort((a, b) => b.sessions - a.sessions);

  return result;
}

// Export handler
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};
