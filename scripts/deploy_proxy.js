#!/usr/bin/env node

/**
 * Deploy Cloudflare Worker proxy
 *
 * Deploys a Worker that proxies requests to GA4 Data API
 * while keeping credentials secure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function deployProxy(config, ga4State) {
  const proxyConfig = config.serverless_proxy || {};
  const workerName = proxyConfig.worker_name || 'brand-analytics-proxy';

  console.log(`  Deploying Cloudflare Worker: ${workerName}...`);

  // Check for Cloudflare auth
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!cfToken) {
    console.log('  Warning: CLOUDFLARE_API_TOKEN not set.');
    console.log('  In dry-run mode, returning placeholder.');
    return {
      worker_url: 'https://brand-analytics-proxy.<subdomain>.workers.dev (placeholder)',
      deployed_at: null,
      deployed: false
    };
  }

  try {
    // Check if wrangler is installed
    let wranglerCmd = 'wrangler';
    try {
      execSync('wrangler --version', { stdio: 'ignore' });
    } catch (e) {
      // Try npx
      try {
        wranglerCmd = 'npx wrangler';
        execSync('npx wrangler --version', { stdio: 'ignore' });
      } catch (e2) {
        throw new Error('Wrangler not found. Install with: npm install -g wrangler');
      }
    }

    // Write wrangler.toml if not exists
    const wranglerTomlPath = path.join(__dirname, '..', 'wrangler.toml');
    writeWranglerToml(wranglerTomlPath, workerName, cfAccountId);

    // Set secrets (GA4 credentials)
    console.log('  Setting Worker secrets...');
    await setWorkerSecrets(workerName, ga4State);

    // Deploy Worker
    console.log('  Deploying Worker...');
    execSync(`${wranglerCmd} deploy --name ${workerName}`, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const workerUrl = `https://${workerName}.${await getWorkerSubdomain(cfToken, cfAccountId)}.workers.dev`;

    console.log(`  Worker deployed: ${workerUrl}`);

    return {
      worker_url: workerUrl,
      deployed_at: new Date().toISOString(),
      deployed: true
    };
  } catch (error) {
    console.log(`  Warning: Could not deploy Worker: ${error.message}`);
    return {
      worker_url: null,
      deployed_at: null,
      deployed: false,
      error: error.message
    };
  }
}

// Write wrangler.toml
function writeWranglerToml(filePath, workerName, accountId) {
  const tomlContent = `name = "${workerName}"
main = "scripts/proxy-worker.js"
compatibility_date = "2024-01-01"
${accountId ? `account_id = "${accountId}"` : '# account_id is set via CLOUDFLARE_ACCOUNT_ID'}

# Secrets (set via wrangler secret put):
# - GA4_CREDENTIALS: Google service account JSON
# - GA4_MEASUREMENT_ID: GA4 measurement ID (e.g., G-XXXXXXXXXX)

[vars]
# Non-sensitive configuration
ALLOWED_ORIGINS = "https://your-username.github.io"
CACHE_TTL = 300
`;
  fs.writeFileSync(filePath, tomlContent);
}

// Set Worker secrets
async function setWorkerSecrets(workerName, ga4State) {
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  // Get Google credentials
  const googleCredsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let googleCreds = '{}';
  if (googleCredsPath && fs.existsSync(googleCredsPath)) {
    googleCreds = fs.readFileSync(googleCredsPath, 'utf8');
  }

  // Set secrets using wrangler
  try {
    // For GA4_CREDENTIALS, we need to escape JSON for shell
    const escapedCreds = googleCreds.replace(/'/g, "'\\''");

    execSync(`echo '${escapedCreds}' | wrangler secret put GA4_CREDENTIALS --name ${workerName}`, {
      env: { ...process.env, CLOUDFLARE_API_TOKEN: cfToken }
    });

    // Set measurement ID
    if (ga4State.measurement_id) {
      execSync(`echo '${ga4State.measurement_id}' | wrangler secret put GA4_MEASUREMENT_ID --name ${workerName}`, {
        env: { ...process.env, CLOUDFLARE_API_TOKEN: cfToken }
      });
    }

    console.log('  Worker secrets configured.');
  } catch (e) {
    console.log('  Note: Could not set secrets automatically. Please run:');
    console.log(`    wrangler secret put GA4_CREDENTIALS --name ${workerName}`);
    console.log(`    wrangler secret put GA4_MEASUREMENT_ID --name ${workerName}`);
  }
}

// Get Worker subdomain
async function getWorkerSubdomain(token, accountId) {
  // In practice, this would query Cloudflare API
  // For now, return a placeholder
  return '<subdomain>';
}

module.exports = deployProxy;

// If run directly
if (require.main === module) {
  const configPath = process.argv[2] || '../config/brand.config.json';
  const config = require(configPath);

  deployProxy(config, { measurement_id: 'G-TEST123' })
    .then(result => {
      console.log('\nProxy deployment complete:');
      console.log(`  Worker URL: ${result.worker_url || 'N/A'}`);
      console.log(`  Deployed: ${result.deployed ? 'Yes' : 'No'}`);
    })
    .catch(err => {
      console.error('Proxy deployment failed:', err.message);
      process.exit(1);
    });
}
