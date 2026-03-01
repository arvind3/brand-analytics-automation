#!/usr/bin/env node

/**
 * Shared Google OAuth token helper.
 *
 * Supports:
 * - GOOGLE_OAUTH_TOKEN (direct access token)
 * - GOOGLE_REFRESH_TOKEN + OAuth client credentials
 * - .ga4-token.json (local cached token from auth:ga4)
 */

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '..', '.ga4-token.json');
const OAUTH_CREDENTIALS_FILE = path.join(__dirname, '..', 'google-oauth-credentials.json');
const EXPIRY_BUFFER_MS = 300000;

function loadOAuthCredentials() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET
    };
  }

  if (process.env.GOOGLE_OAUTH_CREDENTIALS) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_OAUTH_CREDENTIALS);
      const root = parsed.web || parsed.installed || parsed;
      return {
        client_id: root.client_id,
        client_secret: root.client_secret
      };
    } catch (e) {
      return null;
    }
  }

  if (fs.existsSync(OAUTH_CREDENTIALS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_FILE, 'utf8'));
      const root = parsed.web || parsed.installed || parsed;
      return {
        client_id: root.client_id,
        client_secret: root.client_secret
      };
    } catch (e) {
      return null;
    }
  }

  return null;
}

function loadTokenFile() {
  if (!fs.existsSync(TOKEN_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveTokenFile(tokenData) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  } catch (e) {
    // Non-fatal in CI/read-only contexts.
  }
}

function isAccessTokenValid(tokenData) {
  return Boolean(
    tokenData &&
    tokenData.access_token &&
    tokenData.expires_at &&
    Date.now() < tokenData.expires_at - EXPIRY_BUFFER_MS
  );
}

async function refreshAccessToken(refreshToken, credentials) {
  if (!refreshToken || !credentials?.client_id || !credentials?.client_secret) {
    return null;
  }

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
    return null;
  }

  const token = await response.json();
  return {
    access_token: token.access_token,
    expires_at: Date.now() + (token.expires_in * 1000)
  };
}

async function getGoogleAuthToken() {
  if (process.env.GOOGLE_OAUTH_TOKEN) {
    return process.env.GOOGLE_OAUTH_TOKEN;
  }

  const credentials = loadOAuthCredentials();
  const tokenFile = loadTokenFile();

  if (isAccessTokenValid(tokenFile)) {
    return tokenFile.access_token;
  }

  const refreshToken =
    process.env.GOOGLE_REFRESH_TOKEN ||
    tokenFile?.refresh_token ||
    null;

  if (!refreshToken) {
    return null;
  }

  const refreshed = await refreshAccessToken(refreshToken, credentials);
  if (!refreshed?.access_token) {
    return null;
  }

  const mergedToken = {
    ...tokenFile,
    ...refreshed,
    refresh_token: tokenFile?.refresh_token || process.env.GOOGLE_REFRESH_TOKEN
  };

  saveTokenFile(mergedToken);
  return mergedToken.access_token;
}

module.exports = {
  TOKEN_FILE,
  OAUTH_CREDENTIALS_FILE,
  getGoogleAuthToken
};
