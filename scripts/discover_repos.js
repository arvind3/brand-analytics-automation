#!/usr/bin/env node

/**
 * Discover and classify GitHub repositories
 *
 * Fetches all repositories for the configured user/org and classifies them
 * into CORE_PROJECT, ACTIVE_CONTRIBUTION, or PASSIVE_CLONE buckets.
 */

const { execSync } = require('child_process');

// Run GitHub API query via gh CLI or direct API
async function fetchRepos(config) {
  const owner = config.github.owner;
  const token = process.env[config.github.token_env] || process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error('GitHub token not found. Set GITHUB_TOKEN environment variable.');
  }

  // Use gh CLI if available, otherwise use curl
  let repos = [];

  try {
    // Try gh CLI first
    const ghResult = execSync(
      `gh api --paginate /users/${owner}/repos --jq '.[] | {name,full_name,fork,has_pages,html_url,default_branch}'`,
      { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token } }
    );
    repos = ghResult.trim().split('\n').filter(line => line).map(line => JSON.parse(line));
  } catch (e) {
    // Fallback to curl
    const apiBase = 'https://api.github.com';
    const headers = `-H "Authorization: token ${token}" -H "Accept: application/vnd.github.v3+json"`;
    const curlResult = execSync(
      `curl -s ${headers} "${apiBase}/users/${owner}/repos?per_page=100"`,
      { encoding: 'utf8' }
    );
    repos = JSON.parse(curlResult).map(r => ({
      name: r.name,
      full_name: r.full_name,
      fork: r.fork,
      has_pages: r.has_pages,
      html_url: r.html_url,
      default_branch: r.default_branch
    }));
  }

  // Include org repos if configured
  if (config.github.include_org_repos) {
    try {
      const orgReposResult = execSync(
        `gh api --paginate /users/${owner}/orgs --jq '.[].login'`,
        { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token } }
      );
      const orgs = orgReposResult.trim().split('\n').filter(Boolean);

      for (const org of orgs) {
        const orgReposRaw = execSync(
          `gh api --paginate /orgs/${org}/repos --jq '.[] | {name,full_name,fork,has_pages,html_url,default_branch}'`,
          { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token } }
        );
        const orgRepos = orgReposRaw.trim().split('\n').filter(line => line).map(line => JSON.parse(line));
        repos = [...repos, ...orgRepos];
      }
    } catch (e) {
      console.log('  Note: Could not fetch org repos (this is OK if not in orgs)');
    }
  }

  return repos;
}

// Check if user has activity in a fork
async function checkForkActivity(repo, config) {
  const token = process.env[config.github.token_env] || process.env.GITHUB_TOKEN;
  const owner = config.github.owner;

  try {
    // Check for PRs created by user
    const prsResult = execSync(
      `gh search prs --repo=${repo.full_name} --author=${owner} --state=all --json number --jq length`,
      { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token }, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const prCount = parseInt(prsResult.trim()) || 0;

    if (prCount > 0) {
      return { hasActivity: true, prs: prCount, commits: 0 };
    }

    // Check for commits by user (simplified - checks if any commits by author)
    const commitsResult = execSync(
      `gh api /repos/${repo.full_name}/commits --jq '[.[] | select(.author.login == "${owner}")] | length'`,
      { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token }, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const commitCount = parseInt(commitsResult.trim()) || 0;

    return { hasActivity: prCount > 0 || commitCount > 0, prs: prCount, commits: commitCount };
  } catch (e) {
    // If API fails, assume no activity for safety
    return { hasActivity: false, prs: 0, commits: 0 };
  }
}

// Check if repo has deployable site structure
function hasDeployableStructure(repo) {
  // In a real implementation, we'd clone and check
  // For now, use naming conventions as heuristic
  const deployablePatterns = [
    /index\.html$/i,
    /\/docs\//i,
    /package\.json$/i,
    /_config\.yml$/i, // Jekyll
    /config\.toml$/i, // Hugo
    /astro\.config\./i,
    /vite\.config\./i,
    /next\.config\./i
  ];

  // This is a simplified check - real implementation would fetch repo contents
  return false; // Conservative default
}

// Classify a single repository
async function classifyRepo(repo, config) {
  const classification = config.classification || {};

  // Check force include/exclude first
  if (config.github.force_include_repos?.includes(repo.name)) {
    return {
      ...repo,
      classification: 'CORE_PROJECT',
      eligible: true,
      reason: 'force_included'
    };
  }

  if (config.github.force_exclude_repos?.includes(repo.name)) {
    return {
      ...repo,
      classification: 'PASSIVE_CLONE',
      eligible: false,
      reason: 'force_excluded'
    };
  }

  // Exclude specific repos by pattern
  const excludeFilter = process.env.BRAND_EXCLUDE_FILTER || '';
  if (excludeFilter && repo.name.includes(excludeFilter)) {
    return {
      ...repo,
      classification: 'PASSIVE_CLONE',
      eligible: false,
      reason: 'exclude_filter'
    };
  }

  // Classification logic
  if (!repo.fork) {
    // Not a fork - potential CORE_PROJECT
    const isCoreProject = repo.has_pages || hasDeployableStructure(repo);
    return {
      ...repo,
      classification: isCoreProject ? 'CORE_PROJECT' : 'PASSIVE_CLONE',
      eligible: isCoreProject && (!classification.require_pages || repo.has_pages),
      reason: isCoreProject ? 'core_project' : 'no_pages'
    };
  }

  // It's a fork
  if (!classification.include_forks) {
    return {
      ...repo,
      classification: 'PASSIVE_CLONE',
      eligible: false,
      reason: 'fork_not_included'
    };
  }

  // Check fork activity
  const activity = await checkForkActivity(repo, config);
  const isActive = activity.prs > 0 || activity.commits > 0;

  return {
    ...repo,
    classification: isActive ? 'ACTIVE_CONTRIBUTION' : 'PASSIVE_CLONE',
    eligible: isActive,
    reason: isActive ? 'active_contribution' : 'passive_clone',
    activity
  };
}

// Main discovery function
async function discoverRepos(config, options = {}) {
  const { dryRun = false, includeFilter = '*', excludeFilter = '' } = options;

  console.log('  Fetching repositories from GitHub...');
  let repos = await fetchRepos(config);

  // Apply include filter
  if (includeFilter && includeFilter !== '*') {
    repos = repos.filter(r => r.name.includes(includeFilter));
  }

  console.log(`  Fetched ${repos.length} repositories`);

  // Classify each repo
  console.log('  Classifying repositories...');
  const classifiedRepos = [];

  for (const repo of repos) {
    const classified = await classifyRepo(repo, config);
    classifiedRepos.push(classified);

    const status = classified.eligible
      ? `${classified.classification} (eligible)`
      : `${classified.classification} (excluded: ${classified.reason})`;
    console.log(`    - ${repo.name}: ${status}`);
  }

  // Calculate summary
  const total = classifiedRepos.length;
  const eligible = classifiedRepos.filter(r => r.eligible).length;
  const excluded = classifiedRepos.filter(r => r.classification === 'PASSIVE_CLONE').length;

  // Prepare state entries (simplified - without full clone)
  const stateRepos = classifiedRepos.map(r => ({
    name: r.name,
    full_name: r.full_name,
    classification: r.classification,
    eligible: r.eligible,
    strategy_applied: false,
    tracking_installed: false,
    drift_detected: false,
    last_applied_at: null,
    last_validated_at: null,
    dashboard_included: r.eligible,
    project_key: r.eligible ? r.name : null,
    analytics_config_path: null,
    gtm_snippet_path: null,
    errors: []
  }));

  return {
    total,
    eligible,
    excluded,
    repos: stateRepos,
    raw: classifiedRepos
  };
}

module.exports = discoverRepos;

// If run directly
if (require.main === module) {
  const configPath = process.argv[2] || '../config/brand.config.json';
  const config = require(configPath);

  discoverRepos(config, { dryRun: true })
    .then(result => {
      console.log('\nDiscovery complete:');
      console.log(`  Total: ${result.total}`);
      console.log(`  Eligible: ${result.eligible}`);
      console.log(`  Excluded: ${result.excluded}`);
    })
    .catch(err => {
      console.error('Discovery failed:', err.message);
      process.exit(1);
    });
}
