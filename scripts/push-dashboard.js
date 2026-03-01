#!/usr/bin/env node

/**
 * Push Dashboard to GitHub
 *
 * Copies the dashboard files to the dashboard repository
 * and pushes to GitHub Pages.
 *
 * Usage:
 *   node scripts/push-dashboard.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DASHBOARD_SRC = path.join(__dirname, '..', 'dashboard');
const DASHBOARD_REPO = path.join(__dirname, '..', '..', 'brand-analytics-dashboard');
const GITHUB_USER = 'arvind3';
const DASHBOARD_REPO_NAME = 'brand-analytics-dashboard';

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

async function pushDashboard() {
  console.log('='.repeat(60));
  console.log('Push Dashboard to GitHub');
  console.log('='.repeat(60));

  // Check if dashboard repo exists locally
  if (!fs.existsSync(DASHBOARD_REPO)) {
    console.log('\nDashboard repo not found locally. Cloning...');
    run(`git clone https://github.com/${GITHUB_USER}/${DASHBOARD_REPO_NAME}.git ${DASHBOARD_REPO}`);
  }

  // Checkout or create gh-pages branch
  console.log('\nSwitching to gh-pages branch...');
  const checkoutResult = run(`git checkout gh-pages`, { cwd: DASHBOARD_REPO, ignoreError: true });
  const currentBranch = run(`git rev-parse --abbrev-ref HEAD`, { cwd: DASHBOARD_REPO, ignoreError: true });
  if (!checkoutResult || !currentBranch || currentBranch.trim() !== 'gh-pages') {
    run(`git checkout --orphan gh-pages`, { cwd: DASHBOARD_REPO });
    run(`git rm -rf .`, { cwd: DASHBOARD_REPO, ignoreError: true });
  }

  // Copy dashboard files
  console.log('\nCopying dashboard files...');
  const filesToCopy = ['index.html', 'app.js', 'projects.json'];

  for (const file of filesToCopy) {
    const src = path.join(DASHBOARD_SRC, file);
    const dest = path.join(DASHBOARD_REPO, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  Copied: ${file}`);
    } else {
      console.log(`  Missing: ${file}`);
    }
  }

  // Copy data files if they exist
  const dataFiles = ['data-7days.json', 'data-30days.json', 'data-90days.json'];
  for (const file of dataFiles) {
    const src = path.join(DASHBOARD_SRC, file);
    const dest = path.join(DASHBOARD_REPO, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  Copied: ${file}`);
    }
  }

  // Commit and push
  console.log('\nCommitting changes...');
  run(`git add -A`, { cwd: DASHBOARD_REPO });
  const status = run(`git status --porcelain`, { cwd: DASHBOARD_REPO });

  if (!status.trim()) {
    console.log('No changes to commit.');
  } else {
    run(`git commit -m "Update dashboard data ${new Date().toISOString().split('T')[0]}"`, { cwd: DASHBOARD_REPO });
    console.log('Pushing to GitHub...');
    run(`git push -u origin gh-pages`, { cwd: DASHBOARD_REPO });
    console.log('Dashboard pushed successfully!');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Dashboard URL:');
  console.log(`https://${GITHUB_USER}.github.io/${DASHBOARD_REPO_NAME}/`);
  console.log('='.repeat(60));
  console.log('\nNote: It may take 1-2 minutes for GitHub Pages to update.');
}

pushDashboard().catch(err => {
  console.error('Error:', err.message);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
});
