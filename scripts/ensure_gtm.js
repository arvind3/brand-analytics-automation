#!/usr/bin/env node

/**
 * Ensure GTM Container exists
 *
 * Creates or reuses a GTM container with proper tags, triggers, and variables
 * for project attribution tracking.
 */

const { execSync } = require('child_process');

async function ensureGTM(config, ga4State = {}) {
  const gtmConfig = config.gtm || {};
  const containerName = gtmConfig.container_name || 'Personal Brand Container';

  console.log(`  Looking for GTM container: ${containerName}...`);

  // Check if container ID is already configured
  if (gtmConfig.container_id_optional && ga4State?.gtm?.container_id) {
    console.log('  GTM container already configured, skipping creation.');
    return {
      container_id: ga4State.gtm.container_id,
      published_version: ga4State.gtm.published_version,
      last_published_at: ga4State.gtm.last_published_at,
      created: false
    };
  }

  // Try to find existing container
  try {
    const token = getGoogleAuthToken();
    if (token) {
      const accountId = gtmConfig.account_id_optional || await getDefaultAccountId(token);
      if (accountId) {
        const existingContainer = await findGTMContainerByName(token, accountId, containerName);
        if (existingContainer) {
          console.log('  Found existing GTM container.');
          return {
            container_id: existingContainer.containerId,
            published_version: 'existing',
            last_published_at: null,
            created: false
          };
        }
      }
    }
  } catch (e) {
    console.log('  Could not check existing container (may need auth setup).');
  }

  // In dry-run mode, return placeholders
  if (process.argv.includes('--dry-run')) {
    console.log('  [DRY RUN] Would create GTM container.');
    return {
      container_id: 'GTM-XXXXXXX placeholder',
      published_version: null,
      last_published_at: null,
      created: false
    };
  }

  // Create new container
  console.log('  Creating new GTM container...');

  try {
    const token = getGoogleAuthToken();
    if (!token) {
      throw new Error('Google auth token not found. Set up GOOGLE_APPLICATION_CREDENTIALS.');
    }

    const accountId = gtmConfig.account_id_optional || await getDefaultAccountId(token);
    if (!accountId) {
      throw new Error('Could not find GTM account ID. Please configure account_id_optional in config.');
    }

    // Create container
    const newContainer = await createGTMContainer(token, accountId, containerName);

    // Create variables, triggers, tags
    const containerId = newContainer.containerId;
    const workspacePath = `accounts/${accountId}/containers/${containerId}/workspaces/default`;

    // Create GA4 Configuration variable
    await createGA4ConfigVariable(token, workspacePath, ga4State.measurement_id);

    // Create project_key variable (from dataLayer)
    await createProjectKeyVariable(token, workspacePath);

    // Create Page View trigger
    await createPageViewTrigger(token, workspacePath);

    // Create GA4 Page View tag
    await createGA4PageViewTag(token, workspacePath, ga4State.measurement_id);

    // Publish container
    const publishResult = await publishGTMContainer(token, workspacePath);

    return {
      container_id: containerId,
      published_version: publishResult?.syncStatus?.newVersionId || '1',
      last_published_at: new Date().toISOString(),
      created: true
    };
  } catch (error) {
    console.log(`  Warning: Could not create GTM container: ${error.message}`);
    console.log('  Please set up Google Auth and run again, or configure existing container ID in config.');
    return {
      container_id: null,
      published_version: null,
      last_published_at: null,
      created: false,
      error: error.message
    };
  }
}

// Get Google Auth token
function getGoogleAuthToken() {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsPath) {
    try {
      require('fs').readFileSync(credsPath, 'utf8');
      // Would need google-auth-library for proper JWT generation
      return null;
    } catch (e) {
      return null;
    }
  }
  return process.env.GOOGLE_OAUTH_TOKEN || null;
}

// Get default account ID
async function getDefaultAccountId(token) {
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      `curl -s -H "Authorization: Bearer ${token}" "https://www.googleapis.com/tagmanager/v1/accounts"`,
      { encoding: 'utf8' }
    );
    const response = JSON.parse(result);
    return response.account?.[0]?.accountId;
  } catch (e) {
    return null;
  }
}

// Find container by name
async function findGTMContainerByName(token, accountId, containerName) {
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      `curl -s -H "Authorization: Bearer ${token}" "https://www.googleapis.com/tagmanager/v1/accounts/${accountId}/containers"`,
      { encoding: 'utf8' }
    );
    const response = JSON.parse(result);
    return response.container?.find(c => c.name === containerName);
  } catch (e) {
    return null;
  }
}

// Create container
async function createGTMContainer(token, accountId, containerName) {
  const { execSync } = require('child_process');
  const payload = JSON.stringify({
    name: containerName,
    domainName: ['your-domain.com'],
    usageContext: ['WEB']
  });
  const result = execSync(
    `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://www.googleapis.com/tagmanager/v1/accounts/${accountId}/containers"`,
    { encoding: 'utf8' }
  );
  return JSON.parse(result);
}

// Create GA4 Configuration variable
async function createGA4ConfigVariable(token, workspacePath, measurementId) {
  const payload = JSON.stringify({
    name: 'GA4 Configuration',
    type: 'googtag.set.config',
    parameter: [
      { key: 'measurement_id', type: 'template', value: measurementId || '{{GA_MEASUREMENT_ID}}' }
    ]
  });
  try {
    const { execSync } = require('child_process');
    execSync(
      `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://www.googleapis.com/tagmanager/v1/${workspacePath}/variables"`,
      { encoding: 'utf8' }
    );
    console.log('  Created GA4 Configuration variable.');
  } catch (e) {
    console.log('  Warning: Could not create GA4 Configuration variable.');
  }
}

// Create project_key variable
async function createProjectKeyVariable(token, workspacePath) {
  const payload = JSON.stringify({
    name: 'project_key',
    type: 'jsm',
    parameter: [
      { key: 'javascript', type: 'template', value: 'return dataLayer.project_key || "unknown";' }
    ]
  });
  try {
    const { execSync } = require('child_process');
    execSync(
      `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://www.googleapis.com/tagmanager/v1/${workspacePath}/variables"`,
      { encoding: 'utf8' }
    );
    console.log('  Created project_key variable.');
  } catch (e) {
    console.log('  Warning: Could not create project_key variable.');
  }
}

// Create Page View trigger
async function createPageViewTrigger(token, workspacePath) {
  const payload = JSON.stringify({
    name: 'All Pages',
    type: 'PAGEVIEW'
  });
  try {
    const { execSync } = require('child_process');
    execSync(
      `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://www.googleapis.com/tagmanager/v1/${workspacePath}/triggers"`,
      { encoding: 'utf8' }
    );
    console.log('  Created All Pages trigger.');
  } catch (e) {
    console.log('  Warning: Could not create trigger.');
  }
}

// Create GA4 Page View tag
async function createGA4PageViewTag(token, workspacePath, measurementId) {
  const payload = JSON.stringify({
    name: 'GA4 Page View',
    type: 'gaawc',
    parameter: [
      { key: 'measurement_id', type: 'template', value: measurementId || '{{GA_MEASUREMENT_ID}}' },
      { key: 'config_event_parameter', type: 'template', value: [{ key: 'project_key', value: '{{project_key}}' }] }
    ],
    firingTriggerId: ['{{All Pages}}']
  });
  try {
    const { execSync } = require('child_process');
    execSync(
      `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://www.googleapis.com/tagmanager/v1/${workspacePath}/tags"`,
      { encoding: 'utf8' }
    );
    console.log('  Created GA4 Page View tag.');
  } catch (e) {
    console.log('  Warning: Could not create tag.');
  }
}

// Publish container
async function publishGTMContainer(token, workspacePath) {
  const payload = JSON.stringify({});
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://www.googleapis.com/tagmanager/v1/${workspacePath}/versions:publish"`,
      { encoding: 'utf8' }
    );
    console.log('  Published GTM container.');
    return JSON.parse(result);
  } catch (e) {
    console.log('  Warning: Could not publish container.');
    return null;
  }
}

module.exports = ensureGTM;

// If run directly
if (require.main === module) {
  const configPath = process.argv[2] || '../config/brand.config.json';
  const config = require(configPath);

  ensureGTM(config, {})
    .then(result => {
      console.log('\nGTM Setup complete:');
      console.log(`  Container ID: ${result.container_id || 'N/A'}`);
      console.log(`  Published: ${result.published_version || 'N/A'}`);
    })
    .catch(err => {
      console.error('GTM setup failed:', err.message);
      process.exit(1);
    });
}
