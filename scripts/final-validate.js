#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'state', 'state.json');
const CONFIG_PATH = path.join(ROOT, 'config', 'brand.config.json');
const DASHBOARD_PROJECTS_PATH = path.join(ROOT, 'dashboard', 'projects.json');

function walkHtmlFiles(dir, files = []) {
  const skipDirs = new Set(['.git', 'node_modules', '.next', '.nuxt', '.cache', 'coverage']);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        walkHtmlFiles(fullPath, files);
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
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

function main() {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error('state/state.json not found');
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config/brand.config.json not found');
  }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const measurementId = state.ga4?.measurement_id || config.ga4?.measurement_id_optional || '';
  const containerId = state.gtm?.container_id || config.gtm?.container_id_optional || '';

  const eligible = state.repos.filter(repo => repo.eligible);
  const installed = eligible.filter(repo => repo.tracking_installed && repo.strategy_applied);
  const missingInstallation = eligible.filter(repo => !(repo.tracking_installed && repo.strategy_applied));

  const repoChecks = [];
  for (const repo of installed) {
    const cachePath = path.join(ROOT, '.repo-cache', repo.name);
    const htmlFiles = walkHtmlFiles(cachePath);

    let filesChecked = 0;
    let missingGTM = 0;
    let missingGA4 = 0;

    for (const htmlFile of htmlFiles) {
      const content = fs.readFileSync(htmlFile, 'utf8');
      if (!isTrackableHtmlFile(cachePath, htmlFile, content)) {
        continue;
      }
      filesChecked += 1;
      if (!content.includes(containerId)) {
        missingGTM += 1;
      }
      if (measurementId && !content.includes(measurementId)) {
        missingGA4 += 1;
      }
    }

    repoChecks.push({
      repo: repo.full_name,
      filesChecked,
      missingGTM,
      missingGA4
    });
  }

  const totalFilesChecked = repoChecks.reduce((sum, row) => sum + row.filesChecked, 0);
  const filesMissingGTM = repoChecks.reduce((sum, row) => sum + row.missingGTM, 0);
  const filesMissingGA4 = repoChecks.reduce((sum, row) => sum + row.missingGA4, 0);

  let dashboardProjectsCount = 0;
  if (fs.existsSync(DASHBOARD_PROJECTS_PATH)) {
    const dashboardProjects = JSON.parse(fs.readFileSync(DASHBOARD_PROJECTS_PATH, 'utf8'));
    dashboardProjectsCount = Array.isArray(dashboardProjects.projects) ? dashboardProjects.projects.length : 0;
  }

  const expectedDashboardCount = installed.length;
  const dashboardCountMatches = dashboardProjectsCount === expectedDashboardCount;

  const output = {
    checkedAt: new Date().toISOString(),
    measurementId,
    containerId,
    eligibleRepos: eligible.length,
    installedRepos: installed.length,
    missingInstallationRepos: missingInstallation.map(repo => repo.full_name),
    totalFilesChecked,
    filesMissingGTM,
    filesMissingGA4,
    dashboardProjectsCount,
    expectedDashboardCount,
    dashboardCountMatches,
    repoChecks,
    passed:
      missingInstallation.length === 0 &&
      filesMissingGTM === 0 &&
      filesMissingGA4 === 0 &&
      dashboardCountMatches
  };

  const reportsDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const outputPath = path.join(reportsDir, 'final-validation.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`ELIGIBLE_REPOS=${output.eligibleRepos}`);
  console.log(`INSTALLED_REPOS=${output.installedRepos}`);
  console.log(`MISSING_INSTALLATION_REPOS=${missingInstallation.length}`);
  console.log(`TOTAL_HTML_FILES_CHECKED=${output.totalFilesChecked}`);
  console.log(`FILES_MISSING_GTM=${output.filesMissingGTM}`);
  console.log(`FILES_MISSING_GA4=${output.filesMissingGA4}`);
  console.log(`DASHBOARD_PROJECTS_COUNT=${output.dashboardProjectsCount}`);
  console.log(`EXPECTED_DASHBOARD_COUNT=${output.expectedDashboardCount}`);
  console.log(`DASHBOARD_COUNT_MATCH=${output.dashboardCountMatches ? 'PASS' : 'FAIL'}`);
  console.log(`FINAL_VALIDATION=${output.passed ? 'PASS' : 'FAIL'}`);
  console.log(`REPORT_JSON_PATH=${outputPath}`);

  if (!output.passed) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`Validation error: ${error.message}`);
  process.exit(1);
}
