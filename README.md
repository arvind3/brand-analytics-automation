# Personal Brand Analytics Automation

Automated deployment and management of unified analytics tracking across all your GitHub repositories.

## Overview

This platform:
- Discovers and classifies your GitHub repositories
- Sets up Google Analytics 4 (GA4) + Google Tag Manager (GTM) for unified tracking
- Injects tracking snippets into eligible repos
- Deploys a secure Cloudflare Worker proxy for API access
- Builds a central GitHub Pages dashboard with analytics visualizations

## Prerequisites

- **Node.js**: v18 or later
- **npm**: v9 or later
- **Git**: Latest version
- **GitHub CLI**: `gh` (optional but recommended)
- **Cloudflare Wrangler**: For Worker deployment

## Installation

```bash
# Install dependencies
npm install

# Install Playwright browsers (for validation)
npx playwright install
```

## Configuration

1. Copy the example config:
   ```bash
   cp config/brand.config.example.json config/brand.config.json
   ```

2. Edit `config/brand.config.json` with your settings (see [Configuration](#configuration-details) below)

## Authentication Setup

### GitHub

```bash
# Authenticate with GitHub
gh auth login --scopes repo,read:user,user:email

# Token will be auto-retrieved, or set manually:
export GITHUB_TOKEN="your_token"
```

### Google (GA4 + GTM)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable APIs:
   - Google Analytics Admin API
   - Google Tag Manager API
4. Create OAuth credentials (Web application)
5. Add redirect URI: `http://localhost:8080/oauth2callback`
6. Download credentials JSON as `google-oauth-credentials.json` in repo root
7. Authorize locally:
   ```bash
   npm run auth:ga4
   ```
8. Set GA4 property ID:
   ```bash
   export GA4_PROPERTY_ID="525629873"
   ```

### Cloudflare

```bash
# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Set API token
export CLOUDFLARE_API_TOKEN="your_token"
```

## Usage

### Dry Run (Recommended First)

```bash
# See what would happen without making changes
npm run apply -- --dry-run
```

### Apply Changes

```bash
# Execute the automation
npm run apply
```

### Validate

```bash
# Run validation tests
npm run validate
```

### Custom Configuration

```bash
# Use a different config file
npm run apply -- --config config/brand.prod.json

# Filter repos
npm run apply -- --include-filter "my-project-*"
npm run apply -- --exclude-filter "temp-*"
```

## Configuration Details

### config/brand.config.json

| Field | Type | Description |
|-------|------|-------------|
| `github.owner` | string | Your GitHub username |
| `github.token_env` | string | Environment variable name for token |
| `github.include_org_repos` | boolean | Include organization repositories |
| `github.force_include_repos` | string[] | Repos to always include |
| `github.force_exclude_repos` | string[] | Repos to always exclude |
| `classification.include_forks` | boolean | Include forked repos with activity |
| `classification.min_activity_days` | number | Minimum days since last activity |
| `classification.require_pages` | boolean | Require GitHub Pages enabled |
| `ga4.property_name` | string | Name for GA4 property |
| `gtm.container_name` | string | Name for GTM container |
| `serverless_proxy.provider` | string | Provider (cloudflare) |
| `serverless_proxy.worker_name` | string | Worker name |
| `dashboard_repo.name` | string | Dashboard repository name |
| `dashboard_repo.branch` | string | Pages branch (usually gh-pages) |

## Repository Classification

Repos are classified into three buckets:

| Classification | Criteria | Tracked? |
|----------------|----------|----------|
| **CORE_PROJECT** | Not a fork AND (has Pages OR deployable structure) | Yes |
| **ACTIVE_CONTRIBUTION** | Fork AND (PRs by me > 0 OR commits by me > 0) | Yes (if configured) |
| **PASSIVE_CLONE** | Fork AND no PRs AND no commits by me | No (excluded by default) |

## Output

After `npm run apply` completes, you'll see:

```
TOTAL_REPOS_SCANNED=50
TOTAL_ELIGIBLE_REPOS=25
EXCLUDED_PASSIVE_CLONES=20
ALREADY_IMPLEMENTED=10
NET_NEW_IMPLEMENTED=15
DRIFT_REPAIRED=2
FAILED=0
DASHBOARD_VALIDATION=PASS
REPORT_JSON_PATH=reports/latest.json
```

## State Management

The `state/state.json` file tracks:
- Repository classifications
- Implementation status
- Last applied/validation timestamps
- Errors (if any)

This enables idempotent re-runs months later.

## Troubleshooting

### Common Issues

#### GitHub API Rate Limiting
```
Error: API rate limit exceeded
```
**Solution**: Use authenticated token (not anonymous). Consider `GITHUB_TOKEN` from GitHub App for higher limits.

#### Google API Permission Denied
```
Error: User does not have sufficient permissions
```
**Solution**: Verify OAuth scopes and that the signed-in OAuth user has access to the GA4 property/GTM container.

#### Cloudflare Worker Deployment Failed
```
Error: Worker script not found
```
**Solution**: Ensure `scripts/proxy-worker.js` exists and `wrangler.toml` is configured correctly.

#### Dashboard Not Updating
```
Error: Push rejected
```
**Solution**: Check that you have write access to the dashboard repo and the Pages branch.

### Debug Mode

```bash
# Enable verbose logging
export DEBUG=brand-analytics:*
npm run apply
```

### Manual State Reset

To reset state for a specific repo:
```bash
# Edit state.json and remove the repo entry
# Or delete state.json entirely to start fresh
rm state/state.json
```

## Security

- **Never commit tokens or credentials** to the repository
- Use `.env` file (included in `.gitignore`) for local development
- Cloudflare Worker secrets store GA4 credentials securely
- GitHub Pages dashboard reads only aggregated data (no raw analytics exposed)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  GitHub Repos   │────▶│   GTM Container │────▶│   GA4 Property  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Dashboard UI   │◀────│ Cloudflare Worker│◀────│  GA4 Data API   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## License

MIT
