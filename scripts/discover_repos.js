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
    const ghResult = execSync(
      `gh repo list ${owner} --limit 1000 --json name,nameWithOwner,isFork,url,defaultBranchRef,createdAt,pushedAt`,
      { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token } }
    );
    repos = JSON.parse(ghResult).map(r => ({
      name: r.name,
      full_name: r.nameWithOwner,
      fork: r.isFork,
      has_pages: false,
      html_url: r.url,
      default_branch: r.defaultBranchRef?.name || 'main',
      created_at: r.createdAt,
      pushed_at: r.pushedAt
    }));
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
      default_branch: r.default_branch,
      created_at: r.created_at,
      pushed_at: r.pushed_at
    }));
  }

  // Include org repos if configured
  if (config.github.include_org_repos) {
    try {
      const orgReposResult = execSync(
        `gh api /users/${owner}/orgs`,
        { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token } }
      );
      const orgs = JSON.parse(orgReposResult).map(org => org.login);

      for (const org of orgs) {
        const orgReposRaw = execSync(
          `gh repo list ${org} --limit 1000 --json name,nameWithOwner,isFork,url,defaultBranchRef,createdAt,pushedAt`,
          { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token } }
        );
        const orgRepos = JSON.parse(orgReposRaw).map(r => ({
          name: r.name,
          full_name: r.nameWithOwner,
          fork: r.isFork,
          has_pages: false,
          html_url: r.url,
          default_branch: r.defaultBranchRef?.name || 'main',
          created_at: r.createdAt,
          pushed_at: r.pushedAt
        }));
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
      `gh search prs --repo=${repo.full_name} --author=${owner} --state=all --json number --jq "length"`,
      { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token }, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const prCount = parseInt(prsResult.trim()) || 0;

    if (prCount > 0) {
      return { hasActivity: true, prs: prCount, commits: 0 };
    }

    // Check for commits by user (simplified - checks if any commits by author)
    const commitsResult = execSync(
      `gh api /repos/${repo.full_name}/commits --jq "[.[] | select(.author.login == \\\"${owner}\\\")] | length"`,
      { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: token }, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const commitCount = parseInt(commitsResult.trim()) || 0;

    return { hasActivity: prCount > 0 || commitCount > 0, prs: prCount, commits: commitCount };
  } catch (e) {
    // If API fails, assume no activity for safety
    return { hasActivity: false, prs: 0, commits: 0 };
  }
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
    // Non-fork repositories are treated as core projects unless pages are explicitly required.
    const isCoreProject = classification.require_pages ? repo.has_pages : true;
    return {
      ...repo,
      classification: isCoreProject ? 'CORE_PROJECT' : 'PASSIVE_CLONE',
      eligible: isCoreProject,
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
    repo_created_at: r.created_at || null,
    repo_pushed_at: r.pushed_at || null,
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
