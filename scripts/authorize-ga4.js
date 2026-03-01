#!/usr/bin/env node

/**
 * OAuth2 Authorization Script for GA4
 *
 * This script opens a browser window for you to authorize
 * access to your Google Analytics data.
 *
 * Usage:
 *   node scripts/authorize-ga4.js
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Configuration
const CREDENTIALS_FILE = path.join(__dirname, '..', 'google-oauth-credentials.json');
const TOKEN_FILE = path.join(__dirname, '..', '.ga4-token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/tagmanager.readonly',
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
  'https://www.googleapis.com/auth/tagmanager.publish'
].join(' ');

// Load OAuth2 credentials
function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.error('Error: Google OAuth credentials not found!');
    console.error(`Expected at: ${CREDENTIALS_FILE}`);
    console.error('\nPlease download your OAuth2 credentials from:');
    console.error('https://console.cloud.google.com/apis/credentials\n');
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  // Support both flattened credentials and Google's default { web: {...} } format.
  return parsed.web || parsed.installed || parsed;
}

// Generate authorization URL
function getAuthUrl(credentials) {
  const params = new URLSearchParams({
    client_id: credentials.client_id,
    redirect_uri: 'http://localhost:8080/oauth2callback',
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent'  // Force refresh token
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange authorization code for tokens
async function exchangeCode(code) {
  const credentials = loadCredentials();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      redirect_uri: 'http://localhost:8080/oauth2callback',
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

// Refresh access token using refresh token
async function refreshAccessToken(refreshToken) {
  const credentials = loadCredentials();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

// Get valid access token (refresh if needed)
async function getAccessToken() {
  let tokenData = null;
  const forceReauth = process.argv.includes('--force');

  // Try to load existing token
  if (fs.existsSync(TOKEN_FILE) && !forceReauth) {
    tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));

    // Check if token is still valid (with 5 min buffer)
    if (tokenData.expires_at && Date.now() < tokenData.expires_at - 300000) {
      console.log('Using cached access token.');
      return tokenData.access_token;
    }

    // Refresh if we have refresh token
    if (tokenData.refresh_token) {
      console.log('Refreshing access token...');
      const newToken = await refreshAccessToken(tokenData.refresh_token);
      tokenData = {
        ...tokenData,
        access_token: newToken.access_token,
        expires_at: Date.now() + (newToken.expires_in * 1000)
      };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
      return tokenData.access_token;
    }
  }

  // Need fresh authorization
  return null;
}

// Main authorization flow
async function authorize() {
  console.log('='.repeat(60));
  console.log('Google Analytics OAuth2 Authorization');
  console.log('='.repeat(60));
  console.log();

  // Check if already authorized
  const existingToken = await getAccessToken();
  if (existingToken) {
    console.log('Already authorized! Token is valid.');
    console.log(`Token file: ${TOKEN_FILE}`);

    // Test the token by fetching account info
    try {
      const response = await fetch(
        'https://analyticsdata.googleapis.com/v1beta/accounts',
        { headers: { 'Authorization': `Bearer ${existingToken}` } }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('\nConnected accounts:');
        data.accounts?.forEach(acc => {
          console.log(`  - ${acc.displayName} (${acc.name})`);
        });
        console.log('\nAuthorization successful! You can now run the dashboard.');
        return;
      }
    } catch (e) {
      console.log('Token validation failed, re-authorizing...');
    }
  }

  // Start authorization flow
  const credentials = loadCredentials();
  const authUrl = getAuthUrl(credentials);

  console.log('Opening browser for authorization...');
  console.log('If browser does not open, copy this URL:');
  console.log(authUrl);
  console.log();

  // Open browser
  const platform = process.platform;
  const cmd = platform === 'win32' ? `start "" "${authUrl}"` :
              platform === 'darwin' ? `open "${authUrl}"` :
              `xdg-open "${authUrl}"`;

  exec(cmd);

  // Start local server to receive callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);

      if (parsedUrl.pathname === '/oauth2callback') {
        const { code, error } = parsedUrl.query;

        if (error) {
          res.writeHead(400);
          res.end(`Authorization failed: ${error}`);
          server.close();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        try {
          console.log('Authorization code received, exchanging for tokens...');
          const tokenData = await exchangeCode(code);

          // Save tokens
          const savedToken = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: Date.now() + (tokenData.expires_in * 1000),
            scope: tokenData.scope
          };

          fs.writeFileSync(TOKEN_FILE, JSON.stringify(savedToken, null, 2));

          console.log('Tokens saved successfully!');
          console.log(`Token file: ${TOKEN_FILE}`);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authorization Successful</title></head>
              <body style="font-family: sans-serif; padding: 40px;">
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <p>Your GA4 data can now be fetched.</p>
              </body>
            </html>
          `);

          server.close();

          // Verify the token works
          console.log('\nVerifying token...');
          const response = await fetch(
            'https://analyticsdata.googleapis.com/v1beta/accounts',
            { headers: { 'Authorization': `Bearer ${savedToken.access_token}` } }
          );

          if (response.ok) {
            const data = await response.json();
            console.log('\nConnected GA4 accounts:');
            data.accounts?.forEach(acc => {
              console.log(`  - ${acc.displayName} (${acc.name})`);
            });
            console.log('\nAuthorization complete! You can now fetch GA4 data.');
          } else {
            console.log('Warning: Token verification failed, but tokens were saved.');
          }

          resolve();
        } catch (e) {
          res.writeHead(500);
          res.end(`Error: ${e.message}`);
          server.close();
          reject(e);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(8080, () => {
      console.log('Local server listening on http://localhost:8080');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timeout after 5 minutes'));
    }, 300000);
  });
}

// Run authorization
authorize().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
