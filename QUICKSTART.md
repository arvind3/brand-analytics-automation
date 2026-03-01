# Quick Start: Real GA4 Dashboard

This guide will get your dashboard live with **real Google Analytics data** in about 10 minutes.

## Overview

```
Step 1: Create Google OAuth credentials (5 min)
Step 2: Authorize access to your GA4 data (1 min)
Step 3: Fetch real data from GA4 (30 sec)
Step 4: Push dashboard to GitHub (1 min)
Step 5: View your live dashboard!
```

---

## Step 1: Create Google OAuth Credentials

### 1.1 Go to Google Cloud Console
Open: https://console.cloud.google.com/apis/credentials

### 1.2 Create a New Project
- Click the project dropdown at the top
- Click **New Project**
- Name: `Brand Analytics Dashboard`
- Click **Create**

### 1.3 Enable GA4 API
Open: https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com
- Click **Enable**

### 1.4 Configure OAuth Consent Screen
Open: https://console.cloud.google.com/apis/credentials/consent

1. Click **Create** (or **Edit** if exists)
2. **User Type**: Select **External**
3. Fill in:
   - App name: `Brand Analytics Dashboard`
   - User support email: Your Gmail
   - Developer contact: Your Gmail
4. Click **Save and Continue**
5. **Scopes**: Skip (click Save and Continue)
6. **Test users**: Click **Add Users** and add your Gmail address
7. Click **Save and Continue**

### 1.5 Create OAuth Client ID
Open: https://console.cloud.google.com/apis/credentials

1. Click **Create Credentials > OAuth client ID**
2. **Application type**: Web application
3. **Name**: `Brand Analytics Dashboard`
4. Under **Authorized redirect URIs**, click **Add URI**:
   ```
   http://localhost:8080/oauth2callback
   ```
5. Click **Create**
6. **Download the JSON** file
7. Save it as: `C:\Users\arvin\brand-analytics-automation\google-oauth-credentials.json`

---

## Step 2: Authorize Google Access

Open a terminal and run:

```bash
cd C:\Users\arvin\brand-analytics-automation
npm run auth:ga4
```

This will:
1. Open your browser
2. Ask you to sign in with your Gmail
3. Request permission to read GA4 data
4. Save a refresh token locally

You should see:
```
Authorization complete! You can now fetch GA4 data.
```

---

## Step 3: Fetch Real GA4 Data

```bash
npm run fetch:data
```

This fetches your real analytics data for:
- Last 7 days
- Last 30 days
- Last 90 days

Files created in `dashboard/`:
- `data-7days.json`
- `data-30days.json`
- `data-90days.json`

---

## Step 4: Create and Push Dashboard

### 4.1 Initialize Dashboard Repository

```bash
npm run dashboard:init
```

This creates a new GitHub repository: `arvind3/brand-analytics-dashboard`

### 4.2 Push Dashboard

```bash
npm run dashboard:push
```

This pushes your dashboard to GitHub Pages.

---

## Step 5: View Your Live Dashboard

Your dashboard will be live at:

```
https://arvind3.github.io/brand-analytics-dashboard/
```

**Note:** It may take 1-2 minutes for GitHub Pages to publish.

---

## Update Dashboard with Fresh Data

Whenever you want to update your dashboard with the latest GA4 data:

```bash
npm run fetch:data
npm run dashboard:push
```

---

## Scheduled Updates (Optional)

To auto-update your dashboard daily, enable GitHub Actions:

1. Go to: https://github.com/arvind3/brand-analytics-automation/actions
2. Enable Actions if prompted
3. The workflow will run weekly to check for updates

---

## Troubleshooting

### "Not authorized" Error
Run: `npm run auth:ga4`

### "No data available" Error
Run: `npm run fetch:data`

### Dashboard Shows Old Data
Run: `npm run fetch:data` then `npm run dashboard:push`

### GitHub Pages Not Loading
Wait 1-2 minutes and refresh. Check:
https://github.com/arvind3/brand-analytics-dashboard/settings/pages

### OAuth Token Expired
Run: `npm run auth:ga4` to re-authorize

---

## What Data is Displayed?

Your dashboard shows:
- **Total Users** - Active users from GA4
- **Page Views** - Total page views
- **Sessions** - User sessions
- **Engagement Rate** - User engagement percentage
- **Users by Country** - Geographic breakdown
- **Users by Device** - Desktop/Mobile/Tablet
- **Traffic Sources** - Organic, Direct, Referral, etc.
- **Top Projects** - Per-project analytics (by project_key)

All data comes from your GA4 property: `385311652`

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run auth:ga4` | Authorize Google access |
| `npm run fetch:data` | Fetch real GA4 data |
| `npm run dashboard:init` | Create dashboard repo |
| `npm run dashboard:push` | Push dashboard to GitHub |
| `npm run dashboard:serve` | Test dashboard locally |

---

## Files Created

```
C:\Users\arvin\brand-analytics-automation\
├── google-oauth-credentials.json  (created in Step 1)
├── .ga4-token.json                (created in Step 2)
├── dashboard/
│   ├── index.html                 (existing)
│   ├── app.js                     (existing)
│   ├── projects.json              (existing)
│   ├── data-7days.json            (created in Step 3)
│   ├── data-30days.json           (created in Step 3)
│   └── data-90days.json           (created in Step 3)
```

GitHub repositories:
- `arvind3/brand-analytics-automation` - Automation scripts
- `arvind3/brand-analytics-dashboard` - Live dashboard (GitHub Pages)
