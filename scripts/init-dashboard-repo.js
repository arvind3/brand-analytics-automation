#!/usr/bin/env node

/**
 * Initialize Dashboard Repository
 *
 * Creates a new GitHub repository and pushes the dashboard files
 * for GitHub Pages hosting.
 *
 * Usage:
 *   node scripts/init-dashboard-repo.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');
const DASHBOARD_REPO = 'brand-analytics-dashboard';
const GITHUB_USER = 'arvind3';

function run(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...options });
  } catch (e) {
    if (options.ignoreError) {
      return null;
    }
    throw e;
  }
}

async function initDashboard() {
  console.log('='.repeat(60));
  console.log('Initialize Dashboard Repository');
  console.log('='.repeat(60));

  const dashboardRepoPath = path.join(__dirname, '..', '..', DASHBOARD_REPO);

  // Check if repo already exists locally
  if (fs.existsSync(path.join(dashboardRepoPath, '.git'))) {
    console.log('\nDashboard repo already exists locally.');
    console.log(`Location: ${dashboardRepoPath}`);

    const update = process.argv.includes('--update');
    if (!update) {
      console.log('\nUse --update flag to push latest changes.');
      return;
    }
  } else {
    // Check if repo exists on GitHub
    console.log('\nChecking if dashboard repo exists on GitHub...');
    const existsOnGithub = run(
      `gh repo view ${GITHUB_USER}/${DASHBOARD_REPO}`,
      { ignoreError: true, stdio: 'ignore' }
    );

    if (existsOnGithub === null) {
      // Create repo
      console.log('Repo does not exist. Creating on GitHub...');
      run(`gh repo create ${GITHUB_USER}/${DASHBOARD_REPO} --public --source ${DASHBOARD_DIR} --push`);
      console.log(`Created: https://github.com/${GITHUB_USER}/${DASHBOARD_REPO}`);
    } else {
      console.log('Repo exists on GitHub. Cloning...');
      run(`git clone https://github.com/${GITHUB_USER}/${DASHBOARD_REPO}.git ${dashboardRepoPath}`);
    }
  }

  // Initialize GitHub Pages if not already
  console.log('\nSetting up GitHub Pages...');
  const pagesEnabled = run(
    `gh api /repos/${GITHUB_USER}/${DASHBOARD_REPO}/pages`,
    { ignoreError: true, stdio: 'ignore' }
  );

  if (pagesEnabled === null) {
    console.log('Enabling GitHub Pages...');
    run(`gh api --method POST /repos/${GITHUB_USER}/${DASHBOARD_REPO}/pages -f source_branch=gh-pages -f source_path=/`);
    console.log('GitHub Pages enabled!');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Dashboard initialized!');
  console.log('='.repeat(60));
  console.log(`\nDashboard URL: https://${GITHUB_USER}.github.io/${DASHBOARD_REPO}/`);
  console.log('\nNext steps:');
  console.log('1. Run: npm run auth:ga4   (authorize Google access)');
  console.log('2. Run: npm run fetch:data  (fetch real GA4 data)');
  console.log('3. Run: npm run dashboard:push  (push to GitHub)');
}

initDashboard().catch(err => {
  console.error('Error:', err.message);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
});
