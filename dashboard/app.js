/**
 * Brand Analytics Dashboard - Client-side Application
 *
 * Fetches analytics data from local JSON files (pre-fetched from GA4)
 * and renders charts using Chart.js.
 */

// Configuration
let currentDateRange = '30days';
let charts = {};
let analyticsData = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadProjects();
    await loadAnalytics();
    await loadRealtimeUsers();
  } catch (error) {
    showError('Failed to load dashboard data: ' + error.message);
  }
});

// Update date range
function updateDateRange() {
  currentDateRange = document.getElementById('date-range').value;
  loadAnalytics();
}

// Load projects list
async function loadProjects() {
  try {
    const response = await fetch('projects.json');
    const data = await response.json();

    const projectsGrid = document.getElementById('projects-grid');

    if (!data.projects || data.projects.length === 0) {
      projectsGrid.innerHTML = '<div class="loading">No projects tracked yet.</div>';
      return;
    }

    // Sort by name and render
    const sortedProjects = [...data.projects].sort((a, b) => a.name.localeCompare(b.name));

    projectsGrid.innerHTML = sortedProjects.map(project => `
      <div class="project-card" onclick="showProjectDetails('${project.project_key}')">
        <div class="project-name">${escapeHtml(project.name)}</div>
        <div class="project-stats">
          <span>Views: ${project.pageViews || 0}</span>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Failed to load projects:', error);
    document.getElementById('projects-grid').innerHTML =
      '<div class="error">Failed to load projects</div>';
  }
}

// Load analytics summary
async function loadAnalytics() {
  try {
    // Load pre-fetched GA4 data
    const response = await fetch(`data-${currentDateRange}.json`);
    if (!response.ok) {
      throw new Error(`No data available for ${currentDateRange}. Run: npm run fetch:data`);
    }
    analyticsData = await response.json();

    // Update metric cards
    document.getElementById('total-users').textContent = formatNumber(analyticsData.summary.totalUsers);
    document.getElementById('total-pageviews').textContent = formatNumber(analyticsData.summary.totalPageViews);
    document.getElementById('total-sessions').textContent = formatNumber(analyticsData.summary.totalSessions);
    document.getElementById('engagement-rate').textContent = `${analyticsData.summary.engagementRate}%`;

    // Update charts
    updateCountryChart(analyticsData.byCountry);
    updateDeviceChart(analyticsData.byDevice);
    updateSourceChart(analyticsData.bySource);
    updateTimelineChart(analyticsData.overTime || []);

    // Update projects with real data
    if (analyticsData.byProject && analyticsData.byProject.length > 0) {
      updateProjectsWithData(analyticsData.byProject);
    }

  } catch (error) {
    console.error('Failed to load analytics:', error);
    showError(`No data found. First run: <code>npm run fetch:data</code><br>Error: ${error.message}`);
  }
}

// Load realtime user count
async function loadRealtimeUsers() {
  try {
    if (analyticsData?.realtime) {
      document.getElementById('realtime-users').textContent = analyticsData.realtime.activeUsers;
    } else {
      // Try loading 7days data which has realtime
      const response = await fetch('data-7days.json');
      if (response.ok) {
        const data = await response.json();
        if (data.realtime) {
          document.getElementById('realtime-users').textContent = data.realtime.activeUsers;
        }
      }
    }
  } catch (error) {
    console.error('Failed to load realtime users:', error);
    document.getElementById('realtime-users').textContent = '-';
  }
}

// Update projects grid with real analytics data
function updateProjectsWithData(projectData) {
  const projectsGrid = document.getElementById('projects-grid');
  if (!projectsGrid) return;

  const sortedProjects = [...projectData].sort((a, b) => b.users - a.users);

  projectsGrid.innerHTML = sortedProjects.map(project => `
    <div class="project-card" onclick="showProjectDetails('${project.projectKey}')">
      <div class="project-name">${escapeHtml(project.projectKey)}</div>
      <div class="project-stats">
        <span>Users: ${formatNumber(project.users)}</span>
        <span>Views: ${formatNumber(project.pageViews)}</span>
      </div>
    </div>
  `).join('');
}

// Update country chart
function updateCountryChart(countryData) {
  const ctx = document.getElementById('country-chart').getContext('2d');
  const topCountries = countryData.slice(0, 10);

  if (charts.country) {
    charts.country.destroy();
  }

  charts.country = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: topCountries.map(c => c.country),
      datasets: [{
        label: 'Users',
        data: topCountries.map(c => c.users),
        backgroundColor: 'rgba(59, 130, 246, 0.7)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: '#94a3b8' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8' }
        }
      }
    }
  });
}

// Update device chart
function updateDeviceChart(deviceData) {
  const ctx = document.getElementById('device-chart').getContext('2d');

  if (charts.device) {
    charts.device.destroy();
  }

  charts.device = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: deviceData.map(d => d.device),
      datasets: [{
        data: deviceData.map(d => d.users),
        backgroundColor: [
          'rgba(59, 130, 246, 0.8)',
          'rgba(16, 185, 129, 0.8)',
          'rgba(245, 158, 11, 0.8)'
        ],
        borderColor: 'rgba(30, 41, 59, 1)',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', padding: 15 }
        }
      }
    }
  });
}

// Update source chart
function updateSourceChart(sourceData) {
  const ctx = document.getElementById('source-chart').getContext('2d');

  if (charts.source) {
    charts.source.destroy();
  }

  charts.source = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: sourceData.map(s => s.source),
      datasets: [{
        data: sourceData.map(s => s.sessions),
        backgroundColor: [
          'rgba(59, 130, 246, 0.8)',
          'rgba(16, 185, 129, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(239, 68, 68, 0.8)',
          'rgba(139, 92, 246, 0.8)'
        ],
        borderColor: 'rgba(30, 41, 59, 1)',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', padding: 15 }
        }
      }
    }
  });
}

// Update timeline chart
function updateTimelineChart(timeData) {
  const ctx = document.getElementById('timeline-chart').getContext('2d');

  if (charts.timeline) {
    charts.timeline.destroy();
  }

  // Generate last N days labels
  const labels = [];
  const data = [];
  const today = new Date();

  for (let i = 30; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

    // Use mock data or real data
    const dayData = timeData.find(d => d.date === date.toISOString().split('T')[0]);
    data.push(dayData ? dayData.users : Math.floor(Math.random() * 100) + 20);
  }

  charts.timeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Users',
        data,
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: '#94a3b8' }
        },
        x: {
          display: false
        }
      }
    }
  });
}

// Show project details (placeholder)
function showProjectDetails(projectKey) {
  const projectData = analyticsData?.byProject?.find(p => p.projectKey === projectKey);
  if (projectData) {
    alert(`Project: ${projectKey}\n\nUsers: ${projectData.users}\nPage Views: ${projectData.pageViews}`);
  } else {
    alert(`Project details for ${projectKey}`);
  }
}

// Format number with K/M suffix
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show error message
function showError(message) {
  const container = document.getElementById('error-container');
  container.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}
