#!/usr/bin/env node

/**
 * Fetch Real GA4 Data and Update Dashboard
 *
 * This script fetches real analytics data from your GA4 property
 * and generates the dashboard data files.
 *
 * Usage:
 *   node scripts/fetch-ga4-data.js
 */

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '..', '.ga4-token.json');
const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');
const STATE_FILE = path.join(__dirname, '..', 'state', 'state.json');
const CONFIG_FILE = path.join(__dirname, '..', 'config', 'brand.config.json');

// GA4 Property ID from your URL
const PROPERTY_ID = 'properties/385311652';

// Get valid access token
async function getAccessToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error('Not authorized. Run: node scripts/authorize-ga4.js');
  }

  const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));

  // Check if token is still valid (with 5 min buffer)
  if (tokenData.expires_at && Date.now() < tokenData.expires_at - 300000) {
    // Refresh token
    const credentials = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'google-oauth-credentials.json'), 'utf8'
    ));

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        refresh_token: tokenData.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      throw new Error('Token refresh failed. Re-run authorization.');
    }

    const newToken = await response.json();
    tokenData.access_token = newToken.access_token;
    tokenData.expires_at = Date.now() + (newToken.expires_in * 1000);
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  }

  return tokenData.access_token;
}

// Fetch GA4 data
async function fetchGA4Data(startDate, endDate) {
  const accessToken = await getAccessToken();

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
      { name: 'sessionDefaultChannelGrouping' },
      { name: 'customEvent:project_key' }
    ],
    orderBys: [
      { metric: { metricName: 'activeUsers' }, desc: true }
    ]
  };

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/${PROPERTY_ID}:runReport`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GA4 API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Fetch realtime data
async function fetchRealtimeData() {
  const accessToken = await getAccessToken();

  const requestBody = {
    metrics: [{ name: 'activeUsers' }]
  };

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/${PROPERTY_ID}:runRealtimeReport`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    throw new Error(`GA4 Realtime API error: ${response.status}`);
  }

  return response.json();
}

// Parse GA4 response
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
    byProject: [],
    overTime: []
  };

  if (!data.rows || data.rows.length === 0) {
    return result;
  }

  const metricHeaders = data.metricHeaders?.map(h => h.name) || [];
  const dimensionHeaders = data.dimensionHeaders?.map(h => h.name) || [];

  // Aggregation maps
  const countryMap = new Map();
  const deviceMap = new Map();
  const sourceMap = new Map();
  const projectMap = new Map();

  for (const row of data.rows) {
    const metrics = row.metricValues?.map(m => parseInt(m.value) || 0) || [];
    const dimensions = row.dimensionValues?.map(d => d.value) || [];

    // Aggregate totals
    result.totalUsers += metrics[metricHeaders.indexOf('activeUsers')] || 0;
    result.totalPageViews += metrics[metricHeaders.indexOf('screenPageViews')] || 0;
    result.totalSessions += metrics[metricHeaders.indexOf('sessions')] || 0;
    result.engagementRate += metrics[metricHeaders.indexOf('engagementRate')] || 0;
    result.avgSessionDuration += metrics[metricHeaders.indexOf('averageSessionDuration')] || 0;

    // Aggregate by dimensions
    const country = dimensions[dimensionHeaders.indexOf('country')] || 'Unknown';
    const device = dimensions[dimensionHeaders.indexOf('deviceCategory')] || 'Unknown';
    const source = dimensions[dimensionHeaders.indexOf('sessionDefaultChannelGrouping')] || 'Unknown';
    const project = dimensions[dimensionHeaders.indexOf('customEvent:project_key')] || 'Unknown';

    // Country aggregation
    countryMap.set(country, (countryMap.get(country) || 0) + (metrics[0] || 0));

    // Device aggregation
    deviceMap.set(device, (deviceMap.get(device) || 0) + (metrics[0] || 0));

    // Source aggregation
    sourceMap.set(source, (sourceMap.get(source) || 0) + (metrics[metricHeaders.indexOf('sessions')] || 0));

    // Project aggregation
    projectMap.set(project, {
      users: (projectMap.get(project)?.users || 0) + (metrics[0] || 0),
      pageViews: (projectMap.get(project)?.pageViews || 0) + (metrics[1] || 0)
    });
  }

  // Convert maps to arrays
  result.byCountry = Array.from(countryMap.entries()).map(([country, users]) => ({ country, users }));
  result.byDevice = Array.from(deviceMap.entries()).map(([device, users]) => ({ device, users }));
  result.bySource = Array.from(sourceMap.entries()).map(([source, sessions]) => ({ source, sessions }));
  result.byProject = Array.from(projectMap.entries()).map(([projectKey, data]) => ({
    projectKey,
    users: data.users,
    pageViews: data.pageViews
  }));

  // Sort arrays
  result.byCountry.sort((a, b) => b.users - a.users);
  result.byDevice.sort((a, b) => b.users - a.users);
  result.bySource.sort((a, b) => b.sessions - a.sessions);
  result.byProject.sort((a, b) => b.users - a.users);

  // Calculate averages
  const rowCount = data.rows.length || 1;
  result.engagementRate = result.engagementRate / rowCount;
  result.avgSessionDuration = result.avgSessionDuration / rowCount;

  return result;
}

// Main function
async function fetchAndSaveData() {
  console.log('='.repeat(60));
  console.log('Fetching GA4 Data');
  console.log('='.repeat(60));

  // Load config
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const trackedProjects = config.github?.force_include_repos || [];

  // Load state to get tracked repos
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state.repos?.filter(r => r.eligible && r.tracking_installed).forEach(r => {
      if (!trackedProjects.includes(r.project_key)) {
        trackedProjects.push(r.project_key);
      }
    });
  }

  console.log(`\nTracked projects: ${trackedProjects.length}`);

  // Fetch data for different time periods
  const periods = [
    { name: '7days', startDate: '7daysAgo', endDate: 'today' },
    { name: '30days', startDate: '30daysAgo', endDate: 'today' },
    { name: '90days', startDate: '90daysAgo', endDate: 'today' }
  ];

  for (const period of periods) {
    console.log(`\nFetching data for: ${period.name}...`);

    try {
      const ga4Data = await fetchGA4Data(period.startDate, period.endDate);
      const parsedData = parseGA4Response(ga4Data);

      // Fetch realtime data (only for latest)
      let realtimeData = null;
      if (period.name === '7days') {
        try {
          realtimeData = await fetchRealtimeData();
        } catch (e) {
          console.log('  Realtime data not available (this is OK)');
        }
      }

      // Save to dashboard
      const outputFile = path.join(DASHBOARD_DIR, `data-${period.name}.json`);
      const output = {
        generatedAt: new Date().toISOString(),
        period: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        summary: {
          totalUsers: parsedData.totalUsers,
          totalPageViews: parsedData.totalPageViews,
          totalSessions: parsedData.totalSessions,
          avgSessionDuration: Math.round(parsedData.avgSessionDuration),
          engagementRate: Math.round(parsedData.engagementRate * 1000) / 10
        },
        byCountry: parsedData.byCountry,
        byDevice: parsedData.byDevice,
        bySource: parsedData.bySource,
        byProject: parsedData.byProject,
        realtime: realtimeData ? {
          activeUsers: parseInt(realtimeData.rows?.[0]?.metricValues?.[0]?.value) || 0
        } : null
      };

      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`  Saved: ${outputFile}`);
      console.log(`  Users: ${output.summary.totalUsers}, Page Views: ${output.summary.totalPageViews}`);
    } catch (e) {
      console.log(`  Error fetching ${period.name}: ${e.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Data fetch complete!');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('1. Review the generated data files in dashboard/');
  console.log('2. Push dashboard to GitHub:');
  console.log('   npm run dashboard:push');
}

// Run
fetchAndSaveData().catch(err => {
  console.error('Error:', err.message);
  console.error('\nIf not authorized, run: node scripts/authorize-ga4.js');
  process.exit(1);
});
