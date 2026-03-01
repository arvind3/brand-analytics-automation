#!/usr/bin/env node

/**
 * Apply tracking changes to repositories
 *
 * Injects GTM snippets into HTML files and creates analytics.config.json
 * for each eligible repository.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const testRepo = require('./test-repo');

// GTM snippet template (placeholder - actual ID injected at runtime)
const GTM_HEAD_SNIPPET = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;j.setAttributeNode(d.createAttribute('cross-origin'));f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-CONTAINER_ID');</script>
<!-- End Google Tag Manager -->`;

const GTM_BODY_SNIPPET = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-CONTAINER_ID"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

// analytics.config.json template
function createAnalyticsConfig(projectKey, options = {}) {
  return {
    project_key: projectKey,
    gtm: {
      container_id: options.containerId || 'GTM-CONTAINER_ID'
    },
    ga4: {
      measurement_id: options.measurementId || 'G-MEASUREMENT_ID'
    },
    tracking: {
      enabled: true,
      debug: options.debug || false
    },
    _managed_by: 'brand-analytics-automation',
    _version: '1.0.0'
  };
}

// Check if repo already has tracking implemented
function checkTrackingStatus(repoPath, containerId) {
  const results = {
    hasConfigFile: false,
    configPath: null,
    hasGTMSnippet: false,
    gtmPaths: [],
    driftDetected: false
  };

  // Check for analytics.config.json at root
  const configPath = path.join(repoPath, 'analytics.config.json');
  if (fs.existsSync(configPath)) {
    results.hasConfigFile = true;
    results.configPath = 'analytics.config.json';
  }

  // Check in .brand-analytics folder
  const brandConfigPath = path.join(repoPath, '.brand-analytics', 'analytics.config.json');
  if (fs.existsSync(brandConfigPath)) {
    results.hasConfigFile = true;
    results.configPath = '.brand-analytics/analytics.config.json';
  }

  // Check for GTM snippet in HTML files
  const htmlFiles = findHtmlFiles(repoPath);
  for (const htmlFile of htmlFiles) {
    const content = fs.readFileSync(htmlFile, 'utf8');
    if (content.includes('googletagmanager.com/gtm.js')) {
      results.hasGTMSnippet = true;
      results.gtmPaths.push(htmlFile);

      // Check if it has the correct container ID
      if (containerId && !content.includes(containerId)) {
        results.driftDetected = true;
      }
    }
  }

  return results;
}

// Find HTML files in repo
function findHtmlFiles(repoPath) {
  const htmlFiles = [];
  const locations = [
    path.join(repoPath, 'index.html'),
    path.join(repoPath, 'docs', 'index.html'),
    path.join(repoPath, 'public', 'index.html'),
    path.join(repoPath, 'dist', 'index.html'),
    path.join(repoPath, 'build', 'index.html')
  ];

  // Also search for HTML files in root
  try {
    const rootFiles = fs.readdirSync(repoPath);
    for (const file of rootFiles) {
      if (file.endsWith('.html')) {
        htmlFiles.push(path.join(repoPath, file));
      }
    }
  } catch (e) {
    // Ignore
  }

  // Check standard locations
  for (const loc of locations) {
    if (fs.existsSync(loc) && !htmlFiles.includes(loc)) {
      htmlFiles.push(loc);
    }
  }

  return htmlFiles;
}

// Inject GTM snippet into HTML file
function injectGTMSnippet(htmlPath, containerId) {
  let content = fs.readFileSync(htmlPath, 'utf8');
  const originalContent = content;

  // Replace placeholder with actual container ID
  const headSnippet = GTM_HEAD_SNIPPET.replace(/GTM-CONTAINER_ID/g, containerId);
  const bodySnippet = GTM_BODY_SNIPPET.replace(/GTM-CONTAINER_ID/g, containerId);

  // Inject after <head> tag
  if (content.includes('<head>')) {
    content = content.replace('<head>', `<head>\n${headSnippet}`);
  } else if (content.includes('<HEAD>')) {
    content = content.replace('<HEAD>', `<HEAD>\n${headSnippet}`);
  }

  // Inject after <body> tag
  if (content.includes('<body>')) {
    content = content.replace('<body>', `<body>\n${bodySnippet}`);
  } else if (content.includes('<BODY>')) {
    content = content.replace('<BODY>', `<BODY>\n${bodySnippet}`);
  }

  // Only write if changed
  if (content !== originalContent) {
    fs.writeFileSync(htmlPath, content, 'utf8');
    return true;
  }

  return false;
}

// Create analytics.config.json
function createAnalyticsConfigFile(repoPath, projectKey, options) {
  const configPath = path.join(repoPath, 'analytics.config.json');
  const config = createAnalyticsConfig(projectKey, options);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return configPath;
}

// Process a single repository
async function processRepo(repo, config, state, options = {}) {
  const { dryRun = false, cacheDir = './.repo-cache' } = options;
  const containerId = state.gtm?.container_id || 'GTM-CONTAINER_ID';

  const result = {
    name: repo.name,
    full_name: repo.full_name,
    success: false,
    action: 'none',
    changes: [],
    errors: []
  };

  try {
    // Check if already implemented (from state or file check)
    const repoState = state.repos?.find(r => r.full_name === repo.full_name);
    if (repoState?.strategy_applied && !repoState?.drift_detected) {
      result.action = 'skipped';
      result.reason = 'already implemented';
      return result;
    }

    const cachePath = path.join(cacheDir, repo.name);

    // In dry-run mode, skip actual cloning
    if (dryRun) {
      result.action = 'would_apply';
      result.success = true;
      return result;
    }

    // Clone or fetch repo
    if (!fs.existsSync(cachePath)) {
      console.log(`    Cloning ${repo.full_name}...`);
      execSync(`git clone --depth 1 https://github.com/${repo.full_name}.git "${cachePath}"`, {
        env: { ...process.env, GIT_ASKPASS: 'echo' }
      });
    } else {
      console.log(`    Fetching ${repo.full_name}...`);
      execSync('git fetch --depth 1', { cwd: cachePath });
      execSync('git reset --hard origin/' + (repo.default_branch || 'main'), { cwd: cachePath });
    }

    // Check current tracking status
    const trackingStatus = checkTrackingStatus(cachePath, containerId);

    // Determine what needs to be done
    const needsConfig = !trackingStatus.hasConfigFile;
    const needsGTM = !trackingStatus.hasGTMSnippet || trackingStatus.driftDetected;

    if (!needsConfig && !needsGTM) {
      result.action = 'skipped';
      result.reason = 'already implemented';
      result.success = true;
      return result;
    }

    // Apply changes
    const changes = [];

    if (needsConfig) {
      const configPath = createAnalyticsConfigFile(cachePath, repo.name, {
        containerId,
        measurementId: state.ga4?.measurement_id
      });
      changes.push(`Created ${configPath}`);
      result.configPath = configPath;
    }

    if (needsGTM) {
      const htmlFiles = findHtmlFiles(cachePath);
      const injectedPaths = [];

      for (const htmlFile of htmlFiles) {
        if (injectGTMSnippet(htmlFile, containerId)) {
          injectedPaths.push(path.relative(cachePath, htmlFile));
        }
      }

      if (injectedPaths.length > 0) {
        changes.push(`Injected GTM into: ${injectedPaths.join(', ')}`);
        result.gtmPaths = injectedPaths;
      }
    }

    if (changes.length > 0) {
      // TEST: Run build/validation tests BEFORE pushing
      console.log('    Running tests to ensure build is not broken...');
      const testResult = await testRepo(cachePath, repo.name);

      if (!testResult.build.passed) {
        // Build failed - revert changes and report error
        console.log('    TEST FAILED: Reverting changes to avoid breaking build');
        execSync('git checkout -- .', { cwd: cachePath });
        execSync('git clean -fd', { cwd: cachePath });
        result.action = 'test_failed';
        result.changes = changes;
        result.success = false;
        result.errors.push(`Build test failed: ${testResult.build.output || 'Unknown error'}`);
        result.testResults = testResult;
        return result;
      }

      if (!testResult.validation?.passed) {
        // Validation failed with errors (warnings are OK)
        console.log('    TEST FAILED: Validation errors found');
        execSync('git checkout -- .', { cwd: cachePath });
        execSync('git clean -fd', { cwd: cachePath });
        result.action = 'test_failed';
        result.changes = changes;
        result.success = false;
        result.errors.push(`Validation failed: ${JSON.stringify(testResult.validation?.errors || [])}`);
        result.testResults = testResult;
        return result;
      }

      console.log('    Tests passed! Pushing changes...');

      // Commit and push changes
      const branchName = 'add-analytics-tracking';
      execSync(`git checkout -b ${branchName}`, { cwd: cachePath });
      execSync('git add -A', { cwd: cachePath });
      execSync('git commit -m "chore: Add analytics tracking [brand-analytics-automation]"', { cwd: cachePath });

      // Try to push (may fail if no write access)
      try {
        execSync(`git push -u origin ${branchName}`, { cwd: cachePath });
        result.action = 'applied';
        result.changes = changes;
        result.success = true;
        result.prUrl = `https://github.com/${repo.full_name}/compare/${branchName}?expand=1`;
        result.testResults = testResult;
      } catch (pushError) {
        result.action = 'committed_local';
        result.changes = changes;
        result.success = true;
        result.errors.push(`Could not push: ${pushError.message}`);
        result.manualSteps = `Please push branch '${branchName}' from ${cachePath}`;
        result.testResults = testResult;
      }
    }

    return result;
  } catch (error) {
    result.action = 'failed';
    result.errors.push(error.message);
    result.success = false;
    return result;
  }
}

// Main apply function
async function applyRepoChanges(config, state) {
  const options = {
    dryRun: process.argv.includes('--dry-run'),
    cacheDir: process.env.REPO_CACHE_DIR || path.join(__dirname, '..', '.repo-cache')
  };

  // Ensure cache dir exists
  if (!options.dryRun && !fs.existsSync(options.cacheDir)) {
    fs.mkdirSync(options.cacheDir, { recursive: true });
  }

  const eligibleRepos = state.repos?.filter(r => r.eligible) || [];
  console.log(`  Processing ${eligibleRepos.length} eligible repositories...`);

  const results = {
    updatedRepos: [...(state.repos || [])],
    alreadyImplemented: 0,
    netNewImplemented: 0,
    driftRepaired: 0,
    failed: 0,
    details: []
  };

  for (const repo of eligibleRepos) {
    console.log(`  [${results.alreadyImplemented + results.netNewImplemented + results.failed + 1}/${eligibleRepos.length}] ${repo.name}...`);

    const result = await processRepo(repo, config, state, options);
    results.details.push(result);

    // Update state
    const stateIndex = results.updatedRepos.findIndex(r => r.full_name === repo.full_name);
    if (stateIndex >= 0) {
      const repoState = results.updatedRepos[stateIndex];

      if (result.action === 'skipped' && result.reason === 'already implemented') {
        results.alreadyImplemented++;
        repoState.strategy_applied = true;
        repoState.tracking_installed = true;
      } else if (result.action === 'applied' || result.action === 'committed_local') {
        if (result.driftRepaired) {
          results.driftRepaired++;
        } else {
          results.netNewImplemented++;
        }
        repoState.strategy_applied = true;
        repoState.tracking_installed = true;
        repoState.last_applied_at = new Date().toISOString();
        repoState.analytics_config_path = result.configPath || repoState.analytics_config_path;
        repoState.gtm_snippet_path = result.gtmPaths || repoState.gtm_snippet_path;
        repoState.drift_detected = false;
      } else if (result.action === 'failed') {
        results.failed++;
        repoState.errors = result.errors;
      }
    }
  }

  return results;
}

module.exports = applyRepoChanges;

// If run directly
if (require.main === module) {
  const configPath = process.argv[2] || '../config/brand.config.json';
  const config = require(configPath);

  // Load minimal state for testing
  const state = {
    repos: [],
    ga4: { measurement_id: 'G-TEST123' },
    gtm: { container_id: 'GTM-TEST123' }
  };

  applyRepoChanges(config, state)
    .then(results => {
      console.log('\nApply complete:');
      console.log(`  Already implemented: ${results.alreadyImplemented}`);
      console.log(`  Net new: ${results.netNewImplemented}`);
      console.log(`  Drift repaired: ${results.driftRepaired}`);
      console.log(`  Failed: ${results.failed}`);
    })
    .catch(err => {
      console.error('Apply failed:', err.message);
      process.exit(1);
    });
}
