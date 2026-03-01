#!/usr/bin/env node

/**
 * Update central dashboard
 *
 * Updates the dashboard repository with the latest project mappings
 * and aggregated analytics data.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function updateDashboard(config, state) {
  const dashboardConfig = config.dashboard_repo || {};
  const dashboardName = dashboardConfig.name || 'brand-analytics-dashboard';
  const dashboardBranch = dashboardConfig.branch || 'gh-pages';

  console.log(`  Updating dashboard: ${dashboardName}...`);

  // Get list of tracked projects from state
  const trackedRepos = state.repos?.filter(r => r.eligible && r.strategy_applied) || [];
  const projects = trackedRepos.map(r => ({
    name: r.name,
    full_name: r.full_name,
    project_key: r.project_key || r.name,
    tracking_installed: r.tracking_installed,
    last_updated: r.last_applied_at
  }));

  // Update projects mapping file
  const dashboardDir = path.join(__dirname, '..', 'dashboard');
  const projectsConfigPath = path.join(dashboardDir, 'projects.json');

  if (!fs.existsSync(dashboardDir)) {
    fs.mkdirSync(dashboardDir, { recursive: true });
  }

  // Write projects.json
  const projectsConfig = {
    updated_at: new Date().toISOString(),
    projects: projects
  };
  fs.writeFileSync(projectsConfigPath, JSON.stringify(projectsConfig, null, 2));
  console.log(`  Updated projects.json with ${projects.length} projects.`);

  const periods = ['7days', '30days', '90days'];
  for (const period of periods) {
    const dataPath = path.join(dashboardDir, `data-${period}.json`);
    if (!fs.existsSync(dataPath)) {
      const fallback = {
        generatedAt: new Date().toISOString(),
        period,
        startDate: `${period}Ago`,
        endDate: 'today',
        summary: {
          totalUsers: 0,
          totalPageViews: 0,
          totalSessions: 0,
          avgSessionDuration: 0,
          engagementRate: 0
        },
        byCountry: [],
        byDevice: [],
        bySource: [],
        byProject: projects.map(project => ({
          projectKey: project.project_key,
          users: 0,
          pageViews: 0
        })),
        realtime: {
          activeUsers: 0
        }
      };
      fs.writeFileSync(dataPath, JSON.stringify(fallback, null, 2));
    }
  }

  // In a full implementation, we would:
  // 1. Clone/fetch dashboard repo
  // 2. Update projects.json in the repo
  // 3. Fetch aggregated data from proxy
  // 4. Generate static data files for the dashboard
  // 5. Commit and push to gh-pages branch

  // For now, we'll just count the projects
  return {
    last_updated: new Date().toISOString(),
    last_validated: state.dashboard?.last_validated || null,
    validation_passed: state.dashboard?.validation_passed || null,
    projects_count: projects.length,
    projects: projects
  };
}

module.exports = updateDashboard;

// If run directly
if (require.main === module) {
  const configPath = process.argv[2] || '../config/brand.config.json';
  const config = require(configPath);

  // Mock state for testing
  const state = {
    repos: [
      { name: 'project-1', full_name: 'user/project-1', eligible: true, strategy_applied: true, project_key: 'project-1', tracking_installed: true, last_applied_at: new Date().toISOString() },
      { name: 'project-2', full_name: 'user/project-2', eligible: true, strategy_applied: true, project_key: 'project-2', tracking_installed: true, last_applied_at: new Date().toISOString() }
    ],
    dashboard: {}
  };

  updateDashboard(config, state)
    .then(result => {
      console.log('\nDashboard update complete:');
      console.log(`  Projects count: ${result.projects_count}`);
      console.log(`  Updated at: ${result.last_updated}`);
    })
    .catch(err => {
      console.error('Dashboard update failed:', err.message);
      process.exit(1);
    });
}
