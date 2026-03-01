# Personal Brand Analytics - Setup Guide for @arvind3

This guide walks you through completing the setup for your GitHub account (@arvind3).

## Current Status

### Completed
- Repository scaffold created: `brand-analytics-automation/`
- GitHub authentication configured (using gh CLI)
- Repository discovery completed:
  - **49 total repositories** found
  - **18 eligible repositories** (CORE_PROJECT)
  - **31 excluded** (passive clones/forks)

### Pending
- Google Analytics 4 (GA4) Measurement ID configuration
- Google Tag Manager (GTM) Container ID configuration
- Cloudflare Worker deployment (optional)
- Dashboard repository creation

---

## Step 1: Get Your GA4 Measurement ID

1. Go to your GA4 property: https://analytics.google.com/analytics/web/#/a385311652p525629873/admin
2. Click **Data Streams** (in the left sidebar under "Data collection")
3. Click on your web data stream
4. Copy the **Measurement ID** (looks like `G-XXXXXXXXXX`)
5. Update `config/brand.config.json`:
   ```json
   {
     "ga4": {
       "measurement_id_optional": "G-YOUR-ID-HERE"
     }
   }
   ```

---

## Step 2: Get Your GTM Container ID

1. Go to your GTM account: https://tagmanager.google.com/
2. Select or create a container for "Arvind Personal Brand"
3. Copy the **Container ID** (looks like `GTM-XXXXXXX`)
4. Update `config/brand.config.json`:
   ```json
   {
     "gtm": {
       "container_id_optional": "GTM-YOUR-ID-HERE"
     }
   }
   ```

---

## Step 3: (Optional) Set Up Google API Access

For full automation (creating properties, containers, etc.), set up OAuth2:

### Option A: Quick Setup (Recommended for first run)
Manually create GA4 property and GTM container in the UI, then add IDs to config.

### Option B: Full API Access
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable APIs:
   - Google Analytics Admin API
   - Google Tag Manager API
4. Create OAuth 2.0 credentials
5. Download credentials JSON
6. Set environment variable:
   ```bash
   setx GOOGLE_APPLICATION_CREDENTIALS "C:\path\to\credentials.json"
   ```

---

## Step 4: Run the Skill

### Dry Run (Preview Changes)
```bash
cd C:\Users\arvin\brand-analytics-automation
npm run apply -- --dry-run
```

### Full Run (Apply Changes)
```bash
npm run apply
```

This will:
1. Discover and classify your repositories
2. Set up GA4 property (or use existing)
3. Set up GTM container (or use existing)
4. Inject GTM snippets into eligible repos
5. Deploy Cloudflare Worker proxy (if configured)
6. Update dashboard
7. Run validation

---

## Your Eligible Repositories (18)

These repos will get analytics tracking:

1. ai-explorer
2. factory
3. fakerUI
4. github-different-pointofviews
5. github-repo-five-lenses
6. leadership-capability-portfolio
7. merchandising-core-concepts-for-grocery-business
8. Playwrite-CLI
9. PlaywriteClikBookWithIDE
10. process-flow-write
11. qa-intelligence-platform
12. retail_analytics
13. robot-finetune-model
14. robot-framework-ide
15. robot-framework-py-skill
16. RobotFrameworkBookWithIDE
17. test
18. upptime

---

## Step 5: (Optional) Deploy Cloudflare Worker

For the dashboard to work, you need to deploy the proxy:

1. Install Wrangler:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Deploy the Worker:
   ```bash
   npm run worker:deploy
   ```

4. Set secrets:
   ```bash
   wrangler secret put GA4_MEASUREMENT_ID --name arvind-analytics-proxy
   ```

---

## Step 6: View Dashboard

After deployment, serve the dashboard locally:
```bash
npm run dashboard:serve
```

Open http://localhost:8080 in your browser.

---

## Quick Reference

### Commands
```bash
npm run discover     # List repositories
npm run apply        # Run full automation
npm run validate     # Run validation tests
npm run dry-run      # Preview changes
```

### Files to Configure
- `config/brand.config.json` - Main configuration
- `.env` - Environment variables (copy from `.env.example`)

### Important Paths
- State: `state/state.json`
- Reports: `reports/latest.json`
- Scripts: `scripts/*.js`

---

## Troubleshooting

### "Bad credentials" for GitHub
```bash
gh auth refresh
```

### Missing Measurement ID
Check your GA4 Admin > Data Streams

### GTM Container Not Found
Check your GTM Account > Container selection

---

## Next Steps

1. Get your GA4 Measurement ID from the UI
2. Get your GTM Container ID from the UI
3. Update `config/brand.config.json`
4. Run `npm run apply -- --dry-run` to preview
5. Run `npm run apply` to execute

For questions, refer to:
- `README.md` - Full documentation
- `docs/troubleshooting.md` - Common issues
- `skills.md` - Skill contract
