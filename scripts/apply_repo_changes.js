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

const GA4_SNIPPET = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-MEASUREMENT_ID');
</script>`;

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
function checkTrackingStatus(repoPath, containerId, measurementId) {
  const results = {
    hasConfigFile: false,
    configPath: null,
    hasGTMSnippet: false,
    hasGA4Snippet: false,
    gtmPaths: [],
    ga4Paths: [],
    missingGTMPaths: [],
    missingGA4Paths: [],
    totalHtmlFiles: 0,
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
    if (!isTrackableHtmlFile(repoPath, htmlFile, content)) {
      continue;
    }
    const relativePath = path.relative(repoPath, htmlFile);
    const hasAnyGTM = content.includes('googletagmanager.com/gtm.js') || content.includes('googletagmanager.com/ns.html');
    const hasAnyGA4 = content.includes('googletagmanager.com/gtag/js?id=') || content.includes("gtag('config'");
    const hasExpectedGTM = !containerId || content.includes(containerId);
    const hasExpectedGA4 = !measurementId || content.includes(measurementId);

    if (hasAnyGTM && hasExpectedGTM) {
      results.gtmPaths.push(relativePath);
    } else {
      results.missingGTMPaths.push(relativePath);
      if (hasAnyGTM && !hasExpectedGTM) {
        results.driftDetected = true;
      }
    }

    if (!measurementId) {
      results.ga4Paths.push(relativePath);
    } else if (hasAnyGA4 && hasExpectedGA4) {
      results.ga4Paths.push(relativePath);
    } else {
      results.missingGA4Paths.push(relativePath);
      if (hasAnyGA4 && !hasExpectedGA4) {
        results.driftDetected = true;
      }
    }
  }

  results.totalHtmlFiles = results.gtmPaths.length + results.missingGTMPaths.length;
  results.hasGTMSnippet = results.totalHtmlFiles > 0 && results.missingGTMPaths.length === 0;
  results.hasGA4Snippet = results.totalHtmlFiles === 0 || results.missingGA4Paths.length === 0;

  return results;
}

// Find HTML files in repo
function findHtmlFiles(repoPath) {
  const htmlFiles = [];
  const skipDirs = new Set([
    '.git',
    'node_modules',
    '.next',
    '.nuxt',
    '.cache',
    'coverage'
  ]);

  function walk(currentPath) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        htmlFiles.push(fullPath);
      }
    }
  }

  walk(repoPath);
  return htmlFiles;
}

// Inject GTM snippet into HTML file
function injectTrackingSnippets(htmlPath, containerId, measurementId) {
  let content = fs.readFileSync(htmlPath, 'utf8');
  const originalContent = content;

  // Replace placeholder with actual container ID
  const headSnippet = GTM_HEAD_SNIPPET.replace(/GTM-CONTAINER_ID/g, containerId);
  const bodySnippet = GTM_BODY_SNIPPET.replace(/GTM-CONTAINER_ID/g, containerId);
  const ga4Snippet = measurementId
    ? GA4_SNIPPET.replace(/G-MEASUREMENT_ID/g, measurementId)
    : '';

  if (containerId && content.includes('googletagmanager.com/gtm.js') && !content.includes(containerId)) {
    content = content.replace(/GTM-[A-Z0-9]+/g, containerId);
  }
  if (measurementId && content.includes('googletagmanager.com/gtag/js?id=') && !content.includes(measurementId)) {
    content = content.replace(/G-[A-Z0-9]+/g, measurementId);
  }

  // Inject after <head> tag
  if (!content.includes('googletagmanager.com/gtm.js')) {
    if (content.includes('<head>')) {
      content = content.replace('<head>', `<head>\n${headSnippet}`);
    } else if (content.includes('<HEAD>')) {
      content = content.replace('<HEAD>', `<HEAD>\n${headSnippet}`);
    }
  }

  if (measurementId && !content.includes(measurementId)) {
    if (content.includes('<head>')) {
      content = content.replace('<head>', `<head>\n${ga4Snippet}`);
    } else if (content.includes('<HEAD>')) {
      content = content.replace('<HEAD>', `<HEAD>\n${ga4Snippet}`);
    }
  }

  // Inject after <body> tag
  if (!content.includes('googletagmanager.com/ns.html')) {
    if (content.includes('<body>')) {
      content = content.replace('<body>', `<body>\n${bodySnippet}`);
    } else if (content.includes('<BODY>')) {
      content = content.replace('<BODY>', `<BODY>\n${bodySnippet}`);
    }
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

function isTrackableHtmlFile(repoPath, htmlPath, content) {
  const relativePath = path.relative(repoPath, htmlPath).replace(/\\/g, '/');
  const baseName = path.basename(relativePath).toLowerCase();

  if (
    relativePath.includes('/fixtures/') ||
    relativePath.includes('/playwright-report/') ||
    relativePath.includes('/test-results/')
  ) {
    return false;
  }

  if (baseName === 'actions.html' || /^run(_latest|\d+)?\.html$/i.test(baseName)) {
    return false;
  }

  if (content.includes('<meta name="hostname" content="github.com">')) {
    return false;
  }

  return true;
}

function detectBaseBranch(repoPath, repoDefaultBranch) {
  const candidates = [];
  if (repoDefaultBranch) candidates.push(repoDefaultBranch);
  candidates.push('main', 'master');

  try {
    const headRef = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const fromHead = headRef.split('/').pop();
    if (fromHead) {
      return fromHead;
    }
  } catch (e) {
    // ignore
  }

  for (const branch of candidates) {
    try {
      execSync(`git rev-parse --verify origin/${branch}`, {
        cwd: repoPath,
        stdio: 'ignore'
      });
      return branch;
    } catch (e) {
      // try next
    }
  }

  return repoDefaultBranch || 'main';
}

// Process a single repository
async function processRepo(repo, config, state, options = {}) {
  const { dryRun = false, force = false, skipTests = false, cacheDir = './.repo-cache' } = options;
  const containerId = state.gtm?.container_id || 'GTM-CONTAINER_ID';
  const measurementId = state.ga4?.measurement_id || null;

  const result = {
    name: repo.name,
    full_name: repo.full_name,
    success: false,
    action: 'none',
    changes: [],
    errors: []
  };

  try {
    const repoState = state.repos?.find(r => r.full_name === repo.full_name);

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
      const defaultBranch = detectBaseBranch(cachePath, repo.default_branch);
      try {
        execSync(`git checkout ${defaultBranch}`, { cwd: cachePath, stdio: 'ignore' });
      } catch (e) {
        try {
          execSync(`git checkout -b ${defaultBranch} origin/${defaultBranch}`, { cwd: cachePath, stdio: 'ignore' });
        } catch (e2) {
          console.log(`    Warning: Could not checkout base branch ${defaultBranch}`);
        }
      }
      try {
        execSync(`git reset --hard origin/${defaultBranch}`, { cwd: cachePath, stdio: 'ignore' });
      } catch (e) {
        console.log(`    Warning: Could not reset to origin/${defaultBranch}`);
      }
    }

    // Check current tracking status
    const trackingStatus = checkTrackingStatus(cachePath, containerId, measurementId);

    // Determine what needs to be done
    const needsConfig = !trackingStatus.hasConfigFile;
    const needsGTM = trackingStatus.totalHtmlFiles > 0 && !trackingStatus.hasGTMSnippet;
    const needsGA4 = Boolean(measurementId) && trackingStatus.totalHtmlFiles > 0 && !trackingStatus.hasGA4Snippet;
    const driftDetected = trackingStatus.driftDetected;

    if (!needsConfig && !needsGTM && !needsGA4) {
      result.action = 'skipped';
      result.reason = force ? 'already implemented (force had nothing to change)' : 'already implemented';
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

    if (needsGTM || needsGA4 || driftDetected) {
      const htmlFiles = findHtmlFiles(cachePath);
      const injectedPaths = [];

      for (const htmlFile of htmlFiles) {
        const content = fs.readFileSync(htmlFile, 'utf8');
        if (!isTrackableHtmlFile(cachePath, htmlFile, content)) {
          continue;
        }
        if (injectTrackingSnippets(htmlFile, containerId, measurementId)) {
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
      let testResult = {
        build: { passed: true, output: null },
        validation: { passed: true, warnings: [], errors: [] }
      };
      if (!skipTests) {
        console.log('    Running tests to ensure build is not broken...');
        testResult = await testRepo(cachePath, repo.name);
      } else {
        console.log('    Skipping tests (--skip-tests enabled)');
      }

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
      const baseBranch = detectBaseBranch(cachePath, repo.default_branch);

      // Delete existing branch if it exists (from previous failed runs)
      try {
        execSync(`git checkout ${baseBranch}`, { cwd: cachePath, stdio: 'ignore' });
      } catch (e) {
        // Continue
      }
      try {
        execSync(`git branch -D ${branchName}`, { cwd: cachePath, stdio: 'ignore' });
      } catch (e) {
        // Branch doesn't exist, that's OK
      }

      execSync(`git checkout -B ${branchName}`, { cwd: cachePath });
      execSync('git add -A', { cwd: cachePath });
      execSync('git commit -m "chore: Add analytics tracking [brand-analytics-automation]"', { cwd: cachePath });

      // Try to push (may fail if no write access)
      try {
        // Force push to overwrite existing branch
        execSync(`git push -f -u origin ${branchName}`, { cwd: cachePath });
        result.action = 'applied';
        result.changes = changes;
        result.success = true;
        result.driftRepaired = driftDetected || (repoState?.strategy_applied === true && (needsGTM || needsGA4 || needsConfig));
        result.prUrl = `https://github.com/${repo.full_name}/compare/${branchName}?expand=1`;
        result.testResults = testResult;
      } catch (pushError) {
        result.action = 'committed_local';
        result.changes = changes;
        result.success = true;
        result.driftRepaired = driftDetected || (repoState?.strategy_applied === true && (needsGTM || needsGA4 || needsConfig));
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
async function applyRepoChanges(config, state, runtimeOptions = {}) {
  const options = {
    dryRun: runtimeOptions.dryRun ?? process.argv.includes('--dry-run'),
    force: runtimeOptions.force ?? process.argv.includes('--force'),
    skipTests: runtimeOptions.skipTests ?? process.argv.includes('--skip-tests'),
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
    testFailed: 0,
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
      } else if (result.action === 'test_failed') {
        results.testFailed++;
        results.failed++;
        repoState.errors = result.errors;
        repoState.drift_detected = true;
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
