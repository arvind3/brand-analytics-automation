#!/usr/bin/env node

/**
 * Ensure GA4 Property exists
 *
 * Creates or reuses a GA4 property and web data stream.
 * Also creates the custom dimension for project_key.
 */

const { execSync } = require('child_process');
const { getGoogleAuthToken } = require('./google-auth');

async function ensureGA4(config, state = {}) {
  const ga4Config = config.ga4 || {};
  const propertyName = ga4Config.property_name || 'Personal Brand Analytics';

  console.log(`  Looking for GA4 property: ${propertyName}...`);

  // Check if property ID is already configured
  if (ga4Config.property_id_optional && state.ga4?.property_id) {
    console.log('  GA4 property already configured, skipping creation.');
    return {
      property_id: state.ga4.property_id,
      measurement_id: state.ga4.measurement_id,
      data_stream_id: state.ga4.data_stream_id,
      custom_dimension_created: state.ga4.custom_dimension_created || false,
      created: false
    };
  }

  // Try to find existing property by name
  try {
    const token = await getGoogleAuthToken();
    if (token) {
      const existingProperty = await findGA4PropertyByName(token, propertyName);
      if (existingProperty) {
        console.log('  Found existing GA4 property.');

        // Get or create data stream
        const dataStream = await getDataStream(token, existingProperty.name);
        const measurementId = dataStream?.webStreamData?.measurementId;

        // Create custom dimension if not exists
        const customDimCreated = await ensureCustomDimension(token, existingProperty.name);

        return {
          property_id: existingProperty.name.split('/')[1],
          measurement_id: measurementId || ga4Config.measurement_id_optional,
          data_stream_id: dataStream?.name?.split('/')[3],
          custom_dimension_created: customDimCreated,
          created: false
        };
      }
    }
  } catch (e) {
    console.log('  Could not check existing property (may need auth setup).');
  }

  // In dry-run mode, return placeholders
  if (process.argv.includes('--dry-run')) {
    console.log('  [DRY RUN] Would create GA4 property.');
    return {
      property_id: 'GA4_PROPERTY_ID placeholder',
      measurement_id: 'G-XXXXXXXXXX placeholder',
      data_stream_id: 'DATA_STREAM_ID placeholder',
      custom_dimension_created: false,
      created: false
    };
  }

  // Create new property (requires proper auth setup)
  console.log('  Creating new GA4 property...');

  try {
    const token = await getGoogleAuthToken();
    if (!token) {
      throw new Error('Google OAuth token not found. Run: npm run auth:ga4.');
    }

    // Create property via GA4 Admin API
    const newProperty = await createGA4Property(token, propertyName);
    const dataStream = await createDataStream(token, newProperty.name);

    // Create custom dimension
    await ensureCustomDimension(token, newProperty.name);

    return {
      property_id: newProperty.name.split('/')[1],
      measurement_id: dataStream?.webStreamData?.measurementId,
      data_stream_id: dataStream?.name?.split('/')[3],
      custom_dimension_created: true,
      created: true
    };
  } catch (error) {
    console.log(`  Warning: Could not create GA4 property: ${error.message}`);
    console.log('  Please set up Google Auth and run again, or configure existing property IDs in config.');
    return {
      property_id: null,
      measurement_id: null,
      data_stream_id: null,
      custom_dimension_created: false,
      created: false,
      error: error.message
    };
  }
}

// Find existing property by name
async function findGA4PropertyByName(token, name) {
  // Would use googleapis library in full implementation
  // This is a skeleton for the API call
  const { execSync } = require('child_process');
  try {
    const result = execSync(
      `curl -s -H "Authorization: Bearer ${token}" "https://analyticsadmin.googleapis.com/v1beta/properties"`,
      { encoding: 'utf8' }
    );
    const response = JSON.parse(result);
    return response.properties?.find(p => p.displayName === name);
  } catch (e) {
    return null;
  }
}

// Get data stream for property
async function getDataStream(token, propertyResourceName) {
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      `curl -s -H "Authorization: Bearer ${token}" "https://analyticsadmin.googleapis.com/v1beta/${propertyResourceName}/dataStreams"`,
      { encoding: 'utf8' }
    );
    const response = JSON.parse(result);
    return response.dataStreams?.find(s => s.type === 'WEB_DATA_STREAM');
  } catch (e) {
    return null;
  }
}

// Create new GA4 property
async function createGA4Property(token, displayName) {
  const { execSync } = require('child_process');
  const payload = JSON.stringify({
    displayName,
    propertyType: 'ORDINARY_PROPERTY'
  });
  const result = execSync(
    `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://analyticsadmin.googleapis.com/v1beta/properties"`,
    { encoding: 'utf8' }
  );
  return JSON.parse(result);
}

// Create data stream
async function createDataStream(token, propertyResourceName) {
  const { execSync } = require('child_process');
  const payload = JSON.stringify({
    displayName: 'Web Stream',
    type: 'WEB_DATA_STREAM',
    webStreamData: {}
  });
  const result = execSync(
    `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://analyticsadmin.googleapis.com/v1beta/${propertyResourceName}/dataStreams"`,
    { encoding: 'utf8' }
  );
  return JSON.parse(result);
}

// Ensure custom dimension for project_key
async function ensureCustomDimension(token, propertyResourceName) {
  try {
    // Check if already exists
    const existing = await getCustomDimension(token, propertyResourceName, 'project_key');
    if (existing) {
      console.log('  Custom dimension project_key already exists.');
      return true;
    }

    // Create custom dimension
    const { execSync } = require('child_process');
    const payload = JSON.stringify({
      parameterName: 'project_key',
      displayName: 'Project Key',
      description: 'Identifies which project/repo the hit belongs to',
      scope: 'EVENT',
      eventType: 'page_view'
    });
    execSync(
      `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}' "https://analyticsadmin.googleapis.com/v1beta/${propertyResourceName}/customDimensions"`,
      { encoding: 'utf8' }
    );
    console.log('  Created custom dimension: project_key');
    return true;
  } catch (e) {
    console.log(`  Warning: Could not create custom dimension: ${e.message}`);
    return false;
  }
}

// Get custom dimension by parameter name
async function getCustomDimension(token, propertyResourceName, parameterName) {
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      `curl -s -H "Authorization: Bearer ${token}" "https://analyticsadmin.googleapis.com/v1beta/${propertyResourceName}/customDimensions"`,
      { encoding: 'utf8' }
    );
    const response = JSON.parse(result);
    return response.customDimensions?.find(d => d.parameterName === parameterName);
  } catch (e) {
    return null;
  }
}

module.exports = ensureGA4;

// If run directly
if (require.main === module) {
  const configPath = process.argv[2] || '../config/brand.config.json';
  const config = require(configPath);

  ensureGA4(config)
    .then(result => {
      console.log('\nGA4 Setup complete:');
      console.log(`  Property ID: ${result.property_id || 'N/A'}`);
      console.log(`  Measurement ID: ${result.measurement_id || 'N/A'}`);
      console.log(`  Custom Dimension: ${result.custom_dimension_created ? 'Created' : 'Exists/Skipped'}`);
    })
    .catch(err => {
      console.error('GA4 setup failed:', err.message);
      process.exit(1);
    });
}
