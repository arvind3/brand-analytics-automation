#!/usr/bin/env node

/**
 * Apply analytics strategy as code to GA4 + GTM.
 *
 * Default mode is plan (dry-run). Use --apply to mutate APIs.
 *
 * Usage:
 *   node scripts/apply-analytics-strategy.js
 *   node scripts/apply-analytics-strategy.js --apply
 *   node scripts/apply-analytics-strategy.js --strategy config/analytics.strategy.json --apply
 */

const fs = require('fs');
const path = require('path');
const { getGoogleAuthToken } = require('./google-auth');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'brand.config.json');
const STATE_PATH = path.join(ROOT, 'state', 'state.json');
const DEFAULT_STRATEGY_PATH = path.join(ROOT, 'config', 'analytics.strategy.json');

function parseArgs(argv) {
  const args = {
    apply: false,
    strategyPath: DEFAULT_STRATEGY_PATH
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    if (arg === '--strategy' && argv[i + 1]) args.strategyPath = path.resolve(argv[++i]);
  }
  return args;
}

function loadJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolvePropertyId(config, state) {
  if (process.env.GA4_PROPERTY_ID) return String(process.env.GA4_PROPERTY_ID);
  if (state?.ga4?.property_id) return String(state.ga4.property_id);
  if (config?.ga4?.property_id_optional) return String(config.ga4.property_id_optional);
  return null;
}

async function apiRequest(token, method, url, body = null) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(`${method} ${url} failed: ${response.status}`);
    err.status = response.status;
    err.response = json;
    throw err;
  }
  return json;
}

async function listAll(token, url, listKey) {
  const all = [];
  let pageToken = null;
  do {
    const suffix = pageToken ? `${url.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(pageToken)}` : '';
    const data = await apiRequest(token, 'GET', `${url}${suffix}`);
    const items = Array.isArray(data?.[listKey]) ? data[listKey] : [];
    all.push(...items);
    pageToken = data?.nextPageToken || null;
  } while (pageToken);
  return all;
}

async function resolveGtmWorkspacePath(token, strategy, config) {
  if (strategy?.gtm?.workspacePath) return strategy.gtm.workspacePath;

  const accountIdOptional = config?.gtm?.account_id_optional || null;
  const containerIdOptional = config?.gtm?.container_id_optional || null;
  const workspaceName = config?.gtm?.workspace_name || 'Default Workspace';

  let accountId = accountIdOptional;
  if (!accountId) {
    const accounts = await listAll(token, 'https://www.googleapis.com/tagmanager/v2/accounts', 'account');
    accountId = accounts[0]?.accountId || null;
  }
  if (!accountId) {
    throw new Error('Could not resolve GTM account. Set gtm.account_id_optional or strategy.gtm.workspacePath.');
  }

  let containerId = containerIdOptional;
  if (!containerId) {
    const containers = await listAll(token, `https://www.googleapis.com/tagmanager/v2/accounts/${accountId}/containers`, 'container');
    const byName = containers.find(c => c.name === config?.gtm?.container_name);
    containerId = (byName || containers[0])?.containerId || null;
  }
  if (!containerId) {
    throw new Error('Could not resolve GTM container. Set gtm.container_id_optional or strategy.gtm.workspacePath.');
  }

  const workspaces = await listAll(
    token,
    `https://www.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces`,
    'workspace'
  );
  const workspace = workspaces.find(w => w.name === workspaceName) || workspaces[0];
  if (!workspace?.workspaceId) {
    throw new Error('Could not resolve GTM workspace.');
  }

  return `accounts/${accountId}/containers/${containerId}/workspaces/${workspace.workspaceId}`;
}

async function ensureGa4CustomDimensions(token, propertyId, desired, apply) {
  const baseUrl = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/customDimensions`;
  const existing = await listAll(token, baseUrl, 'customDimensions');
  const byParameterName = new Map(existing.map(d => [d.parameterName, d]));

  const actions = [];
  for (const dimension of desired || []) {
    if (!dimension?.parameterName) continue;
    if (byParameterName.has(dimension.parameterName)) {
      actions.push({ type: 'noop', resource: 'ga4.customDimension', name: dimension.parameterName });
      continue;
    }
    actions.push({ type: apply ? 'create' : 'plan-create', resource: 'ga4.customDimension', name: dimension.parameterName });
    if (apply) {
      await apiRequest(token, 'POST', baseUrl, dimension);
    }
  }
  return actions;
}

async function ensureGa4KeyEvents(token, propertyId, desired, apply) {
  const baseUrl = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/keyEvents`;
  const existing = await listAll(token, baseUrl, 'keyEvents');
  const byEventName = new Map(existing.map(e => [e.eventName, e]));

  const actions = [];
  for (const keyEvent of desired || []) {
    if (!keyEvent?.eventName) continue;
    if (byEventName.has(keyEvent.eventName)) {
      actions.push({ type: 'noop', resource: 'ga4.keyEvent', name: keyEvent.eventName });
      continue;
    }
    actions.push({ type: apply ? 'create' : 'plan-create', resource: 'ga4.keyEvent', name: keyEvent.eventName });
    if (apply) {
      await apiRequest(token, 'POST', baseUrl, keyEvent);
    }
  }
  return actions;
}

async function ensureGtmVariables(token, workspacePath, desired, apply) {
  const baseUrl = `https://www.googleapis.com/tagmanager/v2/${workspacePath}/variables`;
  const existing = await listAll(token, baseUrl, 'variable');
  const byName = new Map(existing.map(v => [v.name, v]));
  const actions = [];

  for (const variable of desired || []) {
    if (!variable?.name) continue;
    if (byName.has(variable.name)) {
      actions.push({ type: 'noop', resource: 'gtm.variable', name: variable.name });
      continue;
    }
    actions.push({ type: apply ? 'create' : 'plan-create', resource: 'gtm.variable', name: variable.name });
    if (apply) {
      await apiRequest(token, 'POST', baseUrl, variable);
    }
  }
  return actions;
}

async function ensureGtmTriggers(token, workspacePath, desired, apply) {
  const baseUrl = `https://www.googleapis.com/tagmanager/v2/${workspacePath}/triggers`;
  const existing = await listAll(token, baseUrl, 'trigger');
  const byName = new Map(existing.map(t => [t.name, t]));
  const actions = [];

  for (const trigger of desired || []) {
    if (!trigger?.name) continue;
    if (byName.has(trigger.name)) {
      actions.push({ type: 'noop', resource: 'gtm.trigger', name: trigger.name });
      continue;
    }
    actions.push({ type: apply ? 'create' : 'plan-create', resource: 'gtm.trigger', name: trigger.name });
    if (apply) {
      await apiRequest(token, 'POST', baseUrl, trigger);
    }
  }
  return actions;
}

async function ensureGtmTags(token, workspacePath, desired, apply) {
  const triggerBaseUrl = `https://www.googleapis.com/tagmanager/v2/${workspacePath}/triggers`;
  const tagBaseUrl = `https://www.googleapis.com/tagmanager/v2/${workspacePath}/tags`;

  const triggers = await listAll(token, triggerBaseUrl, 'trigger');
  const triggerByName = new Map(triggers.map(t => [t.name, t.triggerId]));

  const existingTags = await listAll(token, tagBaseUrl, 'tag');
  const tagByName = new Map(existingTags.map(t => [t.name, t]));
  const actions = [];

  for (const tag of desired || []) {
    if (!tag?.name) continue;
    if (tagByName.has(tag.name)) {
      actions.push({ type: 'noop', resource: 'gtm.tag', name: tag.name });
      continue;
    }

    const body = { ...tag };
    if (Array.isArray(tag.firingTriggerNames)) {
      const ids = tag.firingTriggerNames
        .map(name => triggerByName.get(name))
        .filter(Boolean);
      body.firingTriggerId = ids;
      delete body.firingTriggerNames;
    }

    actions.push({ type: apply ? 'create' : 'plan-create', resource: 'gtm.tag', name: tag.name });
    if (apply) {
      await apiRequest(token, 'POST', tagBaseUrl, body);
    }
  }
  return actions;
}

function summarize(actions) {
  const counts = actions.reduce((acc, action) => {
    const key = `${action.resource}:${action.type}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply;
  const strategy = loadJson(args.strategyPath);
  if (!strategy) {
    throw new Error(`Strategy file not found: ${args.strategyPath}`);
  }

  const config = loadJson(CONFIG_PATH, {});
  const state = loadJson(STATE_PATH, {});
  const propertyId = resolvePropertyId(config, state);
  if (!propertyId) {
    throw new Error('GA4 property ID not resolved. Set GA4_PROPERTY_ID or config/state GA4 property.');
  }

  const token = await getGoogleAuthToken();
  if (!token) {
    throw new Error('Google OAuth token not found. Run: npm run auth:ga4');
  }

  const workspacePath = await resolveGtmWorkspacePath(token, strategy, config);
  const actions = [];

  actions.push(...await ensureGa4CustomDimensions(token, propertyId, strategy?.ga4?.customDimensions, apply));
  actions.push(...await ensureGa4KeyEvents(token, propertyId, strategy?.ga4?.keyEvents, apply));
  actions.push(...await ensureGtmVariables(token, workspacePath, strategy?.gtm?.variables, apply));
  actions.push(...await ensureGtmTriggers(token, workspacePath, strategy?.gtm?.triggers, apply));
  actions.push(...await ensureGtmTags(token, workspacePath, strategy?.gtm?.tags, apply));

  const summary = summarize(actions);
  console.log('='.repeat(60));
  console.log(`Analytics Strategy ${apply ? 'APPLY' : 'PLAN'}`);
  console.log('='.repeat(60));
  console.log(`GA4 Property: ${propertyId}`);
  console.log(`GTM Workspace: ${workspacePath}`);
  console.log(`Actions: ${actions.length}`);
  for (const [key, count] of Object.entries(summary)) {
    console.log(`  ${key}=${count}`);
  }

  const reportPath = path.join(ROOT, 'reports', `strategy-${apply ? 'apply' : 'plan'}.json`);
  if (!fs.existsSync(path.dirname(reportPath))) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  }
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        mode: apply ? 'apply' : 'plan',
        propertyId,
        workspacePath,
        actions
      },
      null,
      2
    )
  );
  console.log(`Report: ${reportPath}`);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  if (err.response) {
    console.error(JSON.stringify(err.response, null, 2));
  }
  process.exit(1);
});
