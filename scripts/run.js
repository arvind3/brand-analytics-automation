#!/usr/bin/env node

/**
 * Brand Analytics Automation - Main Orchestrator
 *
 * Usage:
 *   npm run discover [--dry-run]
 *   npm run apply [--dry-run]
 *   npm run validate
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Import modules
const discoverRepos = require('./discover_repos');
const ensureGA4 = require('./ensure_ga4');
const ensureGTM = require('./ensure_gtm');
const applyRepoChanges = require('./apply_repo_changes');
const deployProxy = require('./deploy_proxy');
const updateDashboard = require('./update_dashboard');
const validate = require('./validate');

// Constants
const CONFIG_PATH = process.env.BRAND_CONFIG || path.join(__dirname, '..', 'config', 'brand.config.json');
const STATE_PATH = path.join(__dirname, '..', 'state', 'state.json');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

// Load configuration
function loadConfig(configPath = CONFIG_PATH) {
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Configuration file not found: ${resolvedPath}`);
    console.error('Copy config/brand.config.example.json to config/brand.config.json and edit it.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

// Load or initialize state
function loadState(statePath = STATE_PATH) {
  if (!fs.existsSync(statePath)) {
    return {
      last_updated: null,
      repos: [],
      summary: {
        total_repos_scanned: 0,
        total_eligible_repos: 0,
        excluded_passive_clones: 0,
        already_implemented: 0,
        net_new_implemented: 0,
        drift_repaired: 0,
        failed: 0
      },
      dashboard: {
        last_updated: null,
        last_validated: null,
        validation_passed: null,
        projects_count: 0
      },
      ga4: { property_id: null, measurement_id: null, data_stream_id: null, custom_dimension_created: false },
      gtm: { container_id: null, published_version: null, last_published_at: null },
      proxy: { worker_url: null, deployed_at: null }
    };
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// Save state
function saveState(state, statePath = STATE_PATH) {
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// Save report
function saveReport(report, reportsDir = REPORTS_DIR) {
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const reportPath = path.join(reportsDir, 'latest.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

// Parse command line arguments
function parseArgs(args) {
  const parsed = {
    dryRun: false,
    apply: false,
    validate: false,
    config: CONFIG_PATH,
    includeFilter: '*',
    excludeFilter: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--apply') parsed.apply = true;
    else if (arg === '--validate') parsed.validate = true;
    else if (arg === '--config' && args[i + 1]) {
      parsed.config = args[++i];
    } else if (arg === '--include-filter' && args[i + 1]) {
      parsed.includeFilter = args[++i];
    } else if (arg === '--exclude-filter' && args[i + 1]) {
      parsed.excludeFilter = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`
Brand Analytics Automation

Usage:
  node scripts/run [options]

Options:
  --dry-run         Simulate actions without making changes
  --apply           Execute all automation steps
  --validate        Run validation tests only
  --config <path>   Path to configuration file (default: config/brand.config.json)
  --include-filter  Glob pattern to include repos (default: *)
  --exclude-filter  Glob pattern to exclude repos (default: empty)
  --help, -h        Show this help message

Examples:
  npm run discover              # List and classify repos
  npm run apply -- --dry-run    # Preview changes
  npm run apply                 # Apply all changes
  npm run validate              # Run validation tests
`);
}

// Main execution
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  let state = loadState();

  console.log('='.repeat(60));
  console.log('Brand Analytics Automation');
  console.log('='.repeat(60));
  console.log(`Config: ${args.config}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : args.validate ? 'VALIDATION' : 'APPLY'}`);
  console.log('='.repeat(60));

  const report = {
    started_at: new Date().toISOString(),
    mode: args.dryRun ? 'dry-run' : args.validate ? 'validate' : 'apply',
    config: args.config,
    steps: [],
    errors: []
  };

  try {
    // Step 1: Discover and classify repos
    console.log('\n[Step 1] Discovering and classifying repositories...');
    const discoveryResult = await discoverRepos(config, {
      dryRun: args.dryRun,
      includeFilter: args.includeFilter,
      excludeFilter: args.excludeFilter
    });
    state.repos = discoveryResult.repos;
    state.summary.total_repos_scanned = discoveryResult.total;
    state.summary.total_eligible_repos = discoveryResult.eligible;
    state.summary.excluded_passive_clones = discoveryResult.excluded;
    report.steps.push({ name: 'discover', result: discoveryResult });
    console.log(`  Total: ${discoveryResult.total}, Eligible: ${discoveryResult.eligible}, Excluded: ${discoveryResult.excluded}`);

    if (args.dryRun) {
      console.log('\n[DRY RUN] Would proceed with GA4/GTM setup and repo changes.');
      saveState(state);
      report.completed_at = new Date().toISOString();
      const reportPath = saveReport(report);
      console.log(`\nReport saved to: ${reportPath}`);
      return;
    }

    if (args.validate) {
      // Validation only mode
      console.log('\n[Step] Running validation...');
      const validationResult = await validate(config, state);
      state.dashboard.last_validated = new Date().toISOString();
      state.dashboard.validation_passed = validationResult.passed;
      report.steps.push({ name: 'validate', result: validationResult });

      console.log(`\nValidation: ${validationResult.passed ? 'PASS' : 'FAIL'}`);
      saveState(state);
      report.completed_at = new Date().toISOString();
      const reportPath = saveReport(report);
      console.log(`Report saved to: ${reportPath}`);

      if (!validationResult.passed) {
        process.exit(1);
      }
      return;
    }

    // Step 2: Ensure GA4 property exists
    console.log('\n[Step 2] Setting up GA4 property...');
    const ga4Result = await ensureGA4(config);
    state.ga4 = { ...state.ga4, ...ga4Result };
    report.steps.push({ name: 'ensure_ga4', result: ga4Result });
    console.log(`  Property ID: ${ga4Result.property_id || 'existing'}`);

    // Step 3: Ensure GTM container exists
    console.log('\n[Step 3] Setting up GTM container...');
    const gtmResult = await ensureGTM(config, state.ga4);
    state.gtm = { ...state.gtm, ...gtmResult };
    report.steps.push({ name: 'ensure_gtm', result: gtmResult });
    console.log(`  Container ID: ${gtmResult.container_id || 'existing'}`);

    // Step 4: Apply changes to repos
    console.log('\n[Step 4] Applying changes to repositories...');
    const applyResult = await applyRepoChanges(config, state);
    state.repos = applyResult.updatedRepos;
    state.summary.already_implemented = applyResult.alreadyImplemented;
    state.summary.net_new_implemented = applyResult.netNewImplemented;
    state.summary.drift_repaired = applyResult.driftRepaired;
    state.summary.failed = applyResult.failed;
    report.steps.push({ name: 'apply_repo_changes', result: applyResult });
    console.log(`  Already implemented: ${applyResult.alreadyImplemented}`);
    console.log(`  Net new: ${applyResult.netNewImplemented}`);
    console.log(`  Drift repaired: ${applyResult.driftRepaired}`);
    console.log(`  Failed: ${applyResult.failed}`);

    // Step 5: Deploy proxy
    console.log('\n[Step 5] Deploying Cloudflare Worker proxy...');
    const proxyResult = await deployProxy(config, state.ga4);
    state.proxy = { ...state.proxy, ...proxyResult };
    report.steps.push({ name: 'deploy_proxy', result: proxyResult });
    console.log(`  Worker URL: ${proxyResult.worker_url}`);

    // Step 6: Update dashboard
    console.log('\n[Step 6] Updating dashboard...');
    const dashboardResult = await updateDashboard(config, state);
    state.dashboard = { ...state.dashboard, ...dashboardResult };
    report.steps.push({ name: 'update_dashboard', result: dashboardResult });
    console.log(`  Projects count: ${dashboardResult.projects_count}`);

    // Step 7: Validate
    console.log('\n[Step 7] Running validation...');
    const validationResult = await validate(config, state);
    state.dashboard.last_validated = new Date().toISOString();
    state.dashboard.validation_passed = validationResult.passed;
    report.steps.push({ name: 'validate', result: validationResult });
    console.log(`  Validation: ${validationResult.passed ? 'PASS' : 'FAIL'}`);

    // Print final report
    console.log('\n' + '='.repeat(60));
    console.log('FINAL REPORT');
    console.log('='.repeat(60));
    console.log(`TOTAL_REPOS_SCANNED=${state.summary.total_repos_scanned}`);
    console.log(`TOTAL_ELIGIBLE_REPOS=${state.summary.total_eligible_repos}`);
    console.log(`EXCLUDED_PASSIVE_CLONES=${state.summary.excluded_passive_clones}`);
    console.log(`ALREADY_IMPLEMENTED=${state.summary.already_implemented}`);
    console.log(`NET_NEW_IMPLEMENTED=${state.summary.net_new_implemented}`);
    console.log(`DRIFT_REPAIRED=${state.summary.drift_repaired}`);
    console.log(`FAILED=${state.summary.failed}`);
    console.log(`DASHBOARD_VALIDATION=${validationResult.passed ? 'PASS' : 'FAIL'}`);

    const reportPath = saveReport(report);
    console.log(`REPORT_JSON_PATH=${reportPath}`);
    console.log('='.repeat(60));

    saveState(state);

    if (!validationResult.passed || state.summary.failed > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error('\nFatal error:', error.message);
    report.errors.push({ step: 'unknown', error: error.message, stack: error.stack });
    report.completed_at = new Date().toISOString();
    saveReport(report);
    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
