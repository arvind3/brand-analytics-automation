# Zero-Touch Dashboard Setup Guide

## Overview

This guide sets up a **fully automated dashboard** that:
- Fetches real data from Google Analytics 4 daily
- Deploys to GitHub Pages automatically
- Uses only free Google services
- Stores credentials securely in GitHub Secrets

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Repository                         │
│              (arvind3/brand-analytics-automation)            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  GitHub Actions (Scheduled Daily)                       │ │
│  │                                                          │ │
│  │  1. Fetch GA4 data using OAuth credentials              │ │
│  │  2. Generate dashboard JSON files                       │ │
│  │  3. Deploy to GitHub Pages (gh-pages branch)            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  GitHub Secrets (Encrypted)                             │ │
│  │  - GOOGLE_OAUTH_CREDENTIALS                             │ │
│  │  - GOOGLE_REFRESH_TOKEN                                 │ │
│  │  - GA4_PROPERTY_ID                                      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Auto-deploy
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   GitHub Pages                               │
│         https://arvind3.github.io/brand-analytics-automation │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ index.html   │  │ app.js       │  │ data-*.json  │       │
│  │ (Dashboard)  │  │ (Charts)     │  │ (GA4 Data)   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Fetch Data
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Google Analytics 4                          │
│            Property ID: 385311652                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- GitHub account (you have: @arvind3)
- Google Gmail account (you have)
- GA4 property (you have: 385311652)
- Node.js 18+ installed locally

---

## Setup Steps

### Step 1: Create Google OAuth Credentials (5 min)

1. **Go to Google Cloud Console**
   - Open: https://console.cloud.google.com/apis/credentials

2. **Create a New Project**
   - Click project dropdown → **New Project**
   - Name: `Brand Analytics Dashboard`
   - Click **Create**

3. **Enable GA4 API**
   - Open: https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com
   - Click **Enable**

4. **Configure OAuth Consent Screen**
   - Open: https://console.cloud.google.com/apis/credentials/consent
   - Click **Create** (or **Edit**)
   - **User Type**: Select **External**
   - Fill in:
     - App name: `Brand Analytics Dashboard`
     - User support email: Your Gmail
     - Developer contact: Your Gmail
   - Click **Save and Continue**
   - **Scopes**: Skip (click Save and Continue)
   - **Test users**: Click **Add Users** → Add your Gmail
   - Click **Save and Continue**

5. **Create OAuth Client ID**
   - Open: https://console.cloud.google.com/apis/credentials
   - Click **Create Credentials** → **OAuth client ID**
   - **Application type**: Web application
   - **Name**: `Brand Analytics Dashboard`
   - Under **Authorized redirect URIs**, click **Add URI**:
     ```
     http://localhost:8080/oauth2callback
     ```
   - Click **Create**
   - **Download the JSON** file
   - Save as: `C:\Users\arvin\brand-analytics-automation\google-oauth-credentials.json`

---

### Step 2: Authorize Google Access (Local)

Run in terminal:
```bash
cd C:\Users\arvin\brand-analytics-automation
npm run auth:ga4
```

This will:
1. Open browser for Google sign-in
2. Request GA4 read permission
3. Save refresh token locally

You should see: `Authorization complete!`

---

### Step 3: Push Code to GitHub

The code is already pushed to:
- https://github.com/arvind3/brand-analytics-automation

---

### Step 4: Set GitHub Secrets

Run:
```bash
npm run setup:secrets
```

This will guide you through setting up:
- `GOOGLE_OAUTH_CREDENTIALS` - Your OAuth client JSON
- `GOOGLE_REFRESH_TOKEN` - Your refresh token
- `GA4_PROPERTY_ID` - Your property ID (385311652)

**Manual Alternative** (if script doesn't work):

1. Go to: https://github.com/arvind3/brand-analytics-automation/settings/secrets/actions

2. Add these secrets:

   **GOOGLE_OAUTH_CREDENTIALS**
   - Paste the contents of `google-oauth-credentials.json`

   **GOOGLE_REFRESH_TOKEN**
   - Paste the refresh_token from `.ga4-token.json`

   **GA4_PROPERTY_ID**
   - Value: `385311652`

---

### Step 5: Enable GitHub Pages

1. Go to: https://github.com/arvind3/brand-analytics-automation/settings/pages

2. Under **Source**:
   - Select: **Deploy from a branch**
   - Branch: **gh-pages**
   - Folder: **/ (root)**
   - Click **Save**

3. Wait 1-2 minutes for GitHub Pages to activate

---

### Step 6: Run First Manual Deploy

1. Go to: https://github.com/arvind3/brand-analytics-automation/actions/workflows/dashboard-update.yml

2. Click **Run workflow** → **Run workflow**

3. Wait for the workflow to complete (~2 minutes)

4. Your dashboard is live at:
   ```
   https://arvind3.github.io/brand-analytics-automation/
   ```

---

## Automatic Updates

Your dashboard will auto-update:
- **Daily at 6 AM UTC** (via scheduled workflow)
- **On-demand** via "Run workflow" button

---

## Dashboard Features

Your live dashboard shows:

| Metric | Description |
|--------|-------------|
| Total Users | Active users from GA4 |
| Page Views | Total page views |
| Sessions | User sessions |
| Engagement Rate | User engagement % |
| Users by Country | Geographic breakdown |
| Users by Device | Desktop/Mobile/Tablet |
| Traffic Sources | Organic, Direct, Referral, Social |
| Top Projects | Per-project analytics |

---

## Security

All credentials are stored securely:

| Secret | Storage | Encryption |
|--------|---------|------------|
| GOOGLE_OAUTH_CREDENTIALS | GitHub Secrets | GitHub encrypted |
| GOOGLE_REFRESH_TOKEN | GitHub Secrets | GitHub encrypted |
| GA4_PROPERTY_ID | GitHub Secrets | Plain (public ID) |

**No credentials in code** - All sensitive data is in GitHub Secrets only.

---

## Troubleshooting

### Workflow Fails

1. Check workflow logs: https://github.com/arvind3/brand-analytics-automation/actions
2. Verify secrets are set correctly
3. Re-run workflow

### "Not Authorized" Error

Run locally:
```bash
npm run auth:ga4
npm run setup:secrets
```

### "No Data" Error

1. Verify GA4 Property ID is correct
2. Check service account has GA4 access
3. Re-authorize: `npm run auth:ga4`

### GitHub Pages Not Loading

1. Wait 2-3 minutes after deploy
2. Check Pages status: https://github.com/arvind3/brand-analytics-automation/settings/pages
3. Clear browser cache

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run auth:ga4` | Authorize Google OAuth |
| `npm run fetch:data` | Fetch GA4 data locally |
| `npm run setup:secrets` | Configure GitHub Secrets |
| `npm run dashboard:serve` | Test dashboard locally |

---

## Files Overview

```
brand-analytics-automation/
├── .github/workflows/
│   ├── dashboard-update.yml    # Auto-deploy workflow (daily)
│   └── validation.yml          # Validation workflow
├── dashboard/
│   ├── index.html              # Dashboard UI
│   ├── app.js                  # Chart rendering (Chart.js)
│   ├── projects.json           # Tracked projects list
│   └── data-*.json             # GA4 data (generated)
├── scripts/
│   ├── authorize-ga4.js        # OAuth authorization
│   ├── fetch-ga4-data.js       # Fetch GA4 data
│   └── setup-github-secrets.js # Secrets setup helper
└── config/
    └── brand.config.json       # Configuration
```

---

## Cost

**100% Free** - Using:
- Google Analytics 4 (free tier)
- Google OAuth 2.0 (free)
- GitHub Actions (free for public repos)
- GitHub Pages (free)

No credit card required. No paid services.

---

## Support

For issues:
1. Check workflow logs in GitHub Actions
2. Review `docs/troubleshooting.md`
3. Re-run setup steps

---

## Dashboard URL

Your live dashboard:
```
https://arvind3.github.io/brand-analytics-automation/
```
