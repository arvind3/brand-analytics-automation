#!/usr/bin/env node

/**
 * Setup GitHub Secrets for Zero-Touch Dashboard
 *
 * This script guides you through setting up the required secrets
 * for automated dashboard updates.
 *
 * Usage:
 *   node scripts/setup-github-secrets.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' });
}

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function setupSecrets() {
  console.log('='.repeat(60));
  console.log('GitHub Secrets Setup for Zero-Touch Dashboard');
  console.log('='.repeat(60));
  console.log();

  const repo = 'arvind3/brand-analytics-automation';

  console.log('This script will help you set up GitHub Secrets for:');
  console.log('1. Google OAuth credentials (for GA4 API access)');
  console.log('2. GA4 Property ID');
  console.log();

  // Check if credentials file exists
  const credsPath = path.join(__dirname, '..', 'google-oauth-credentials.json');
  const tokenPath = path.join(__dirname, '..', '.ga4-token.json');

  // Step 1: Get Google OAuth Credentials
  console.log('Step 1: Google OAuth Credentials');
  console.log('-'.repeat(40));

  let oauthCredentials = null;
  let refreshToken = null;

  if (fs.existsSync(credsPath)) {
    console.log('Found google-oauth-credentials.json');
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    oauthCredentials = JSON.stringify(creds);

    if (fs.existsSync(tokenPath)) {
      const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      if (token.refresh_token) {
        refreshToken = token.refresh_token;
        console.log('Found refresh token in .ga4-token.json');
      }
    }
  }

  if (!oauthCredentials) {
    console.log('\nYou need to create OAuth credentials first:');
    console.log('1. Go to: https://console.cloud.google.com/apis/credentials');
    console.log('2. Create OAuth 2.0 Client ID (Web application)');
    console.log('3. Add redirect URI: http://localhost:8080/oauth2callback');
    console.log('4. Download the JSON credentials');
    console.log('5. Run: npm run auth:ga4');
    console.log();

    const credsInput = await question('Paste your Google OAuth credentials JSON (or press Enter to skip): ');
    if (credsInput.trim()) {
      try {
        JSON.parse(credsInput);
        oauthCredentials = credsInput;
      } catch (e) {
        console.log('Invalid JSON. Skipping...');
      }
    }
  }

  console.log();
  console.log('Step 2: Set GitHub Secrets');
  console.log('-'.repeat(40));
  console.log();
  console.log('Setting secrets via GitHub CLI...');

  // Set secrets using gh CLI
  if (oauthCredentials) {
    try {
      run(`gh secret set GOOGLE_OAUTH_CREDENTIALS --body "${oauthCredentials.replace(/"/g, '\\"')}" --repo ${repo}`);
      console.log('✓ Set GOOGLE_OAUTH_CREDENTIALS');
    } catch (e) {
      console.log('✗ Failed to set GOOGLE_OAUTH_CREDENTIALS');
      console.log('  Manual: gh secret set GOOGLE_OAUTH_CREDENTIALS --repo ' + repo);
    }
  }

  if (refreshToken) {
    try {
      run(`gh secret set GOOGLE_REFRESH_TOKEN --body "${refreshToken}" --repo ${repo}`);
      console.log('✓ Set GOOGLE_REFRESH_TOKEN');
    } catch (e) {
      console.log('✗ Failed to set GOOGLE_REFRESH_TOKEN');
      console.log('  Manual: gh secret set GOOGLE_REFRESH_TOKEN --repo ' + repo);
    }
  }

  // GA4 Property ID
  const ga4PropertyId = '385311652';
  try {
    run(`gh secret set GA4_PROPERTY_ID --body "${ga4PropertyId}" --repo ${repo}`);
    console.log('✓ Set GA4_PROPERTY_ID');
  } catch (e) {
    console.log('✗ Failed to set GA4_PROPERTY_ID');
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Setup Complete!');
  console.log('='.repeat(60));
  console.log();
  console.log('Next Steps:');
  console.log('1. Go to https://github.com/' + repo + '/settings/actions');
  console.log('2. Ensure Actions are enabled');
  console.log('3. Go to https://github.com/' + repo + '/settings/pages');
  console.log('4. Set Source to "Deploy from a branch"');
  console.log('5. Select branch: gh-pages');
  console.log();
  console.log('Your dashboard will auto-update daily at 6 AM UTC!');
  console.log('Dashboard URL: https://arvind3.github.io/brand-analytics-automation/');
  console.log();

  rl.close();
}

setupSecrets().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});
