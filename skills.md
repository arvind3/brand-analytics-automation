# Personal Brand Analytics Automation Skill

## Purpose/Summary

This skill automates the deployment and management of a unified analytics tracking system across all eligible GitHub repositories owned by or contributed to by a personal brand. It implements a zero-touch, idempotent automation that:

1. Discovers and classifies GitHub repositories
2. Sets up GA4 property + GTM container (or reuses existing)
3. Injects GTM tracking snippets into eligible repos
4. Deploys a secure Cloudflare Worker proxy for GA4 Data API access
5. Builds and updates a central GitHub Pages dashboard
6. Validates the entire system via API health checks and Playwright tests

The skill is designed to be re-run months later, applying changes only to newly eligible repos and repairing any drift.

---

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--config` | string | `config/brand.config.json` | Path to configuration file |
| `--dry-run` | boolean | `false` | Simulate actions without making changes |
| `--apply` | boolean | `false` | Execute all automation steps |
| `--validate` | boolean | `false` | Run validation tests only |
| `--include-filter` | string | `*` | Glob pattern to include repos |
| `--exclude-filter` | string | `` | Glob pattern to exclude repos |

---

## Tools Required

- **GitHub CLI/API**: `gh`, GitHub REST API v3, GraphQL API
- **Google APIs**: GA4 Admin API, GA4 Data API, GTM API (via OAuth)
- **Cloudflare CLI**: `wrangler` for Worker deployment
- **Node.js**: v18+ for scripts
- **Playwright**: For end-to-end dashboard validation
- **Git**: For repository operations

---

## Authentication Requirements

### GitHub
- **Token**: Set via `GITHUB_TOKEN` environment variable
- **Scopes**: `repo`, `read:user`, `user:email`
- **Setup**:
  ```bash
  gh auth login --scopes repo,read:user,user:email
  export GITHUB_TOKEN=$(gh auth token)
  ```

### Google (GA4 + GTM)
- **Auth Method**: OAuth 2.0 with service account or user OAuth flow
- **Required Scopes**:
  - `https://www.googleapis.com/auth/analytics.edit`
  - `https://www.googleapis.com/auth/tagmanager.manage.users`
  - `https://www.googleapis.com/auth/tagmanager.readonly`
- **Setup**:
  1. Create OAuth credentials in Google Cloud Console
  2. Download `credentials.json` or service account key
  3. Set `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_CLIENT_SECRET`

### Cloudflare
- **Token**: Set via `CLOUDFLARE_API_TOKEN` environment variable
- **Scopes**: `Cloudflare Workers:Edit`, `Cloudflare Workers:Write`
- **Secrets**: GA4 credentials stored as Worker secrets (not in code)
- **Setup**:
  ```bash
  export CLOUDFLARE_API_TOKEN="your_token"
  wrangler login
  ```

---

## Step-by-Step Procedure

### Phase 1: Discovery
1. Fetch all repositories via GitHub API (user's repos + org repos if configured)
2. Classify each repo:
   - **CORE_PROJECT**: `fork == false` AND (`has_pages == true` OR has deployable site structure)
   - **ACTIVE_CONTRIBUTION**: `fork == true` AND (`PRs_by_me > 0` OR `commits_by_me > 0`)
   - **PASSIVE_CLONE**: `fork == true` AND `PRs_by_me == 0` AND `commits_by_me == 0`
3. Apply include/exclude filters
4. Update `state/state.json` with classifications

### Phase 2: GA4 + GTM Setup
1. Check if GA4 property exists (by name in config)
2. If not exists, create GA4 property + web data stream
3. Extract Measurement ID
4. Create custom dimension `project_key` in GA4
5. Check if GTM container exists (by name in config)
6. If not exists, create GTM container
7. Create GTM variables, triggers, tags for project attribution
8. Publish GTM container version

### Phase 3: Repo Implementation
For each eligible repo:
1. Check if strategy already applied:
   - Has `analytics.config.json` at root or `/.brand-analytics/analytics.config.json`
   - Default HTML contains GTM snippet with matching container ID
   - State store shows `tracking_installed=true`
2. If already applied: check for drift (snippet missing) and repair if needed
3. If not applied:
   - Clone repo (or fetch if already cached)
   - Detect site structure (`index.html`, `/docs/index.html`, SSG patterns)
   - Inject GTM snippet after `<head>` opening tag
   - Create `analytics.config.json` with `project_key`
   - Commit and push changes
   - Update state.json

### Phase 4: Proxy Deployment
1. Write/update Cloudflare Worker code
2. Set Worker secrets (GA4 credentials)
3. Deploy Worker via `wrangler deploy`
4. Record Worker URL in config

### Phase 5: Dashboard Update
1. Fetch list of all tracked projects from state.json
2. Update dashboard's project mapping file
3. Build dashboard assets (if build step exists)
4. Commit and push to dashboard repo's Pages branch

### Phase 6: Validation
1. API Health Check:
   - Verify GA4 property accessible
   - Verify GTM container published
   - Verify Worker responds
2. Playwright Tests:
   - Dashboard loads
   - Key widgets present
   - Projects list populated
3. Update state.json with validation timestamps

---

## Idempotency Rules

The skill detects existing installations and skips or repairs:

| Condition | Action |
|-----------|--------|
| `analytics.config.json` exists | Skip config creation |
| GTM snippet found in HTML with matching ID | Skip injection |
| State shows `tracking_installed=true` | Skip unless drift detected |
| GA4 property exists by name | Reuse existing |
| GTM container exists by name | Reuse existing |
| Worker deployed with same name | Update only if code changed |

**Drift Detection**: If HTML no longer contains GTM snippet (e.g., was removed), the skill repairs by re-injecting.

---

## Validation Plan

### Acceptance Criteria

- [ ] All CORE_PROJECT repos have GTM snippet injected
- [ ] All ACTIVE_CONTRIBUTION repos (if configured) have GTM snippet injected
- [ ] No PASSIVE_CLONE repos are tracked (unless override)
- [ ] GA4 custom dimension `project_key` exists
- [ ] GTM container published with correct tags
- [ ] Cloudflare Worker responds to requests
- [ ] Dashboard loads and shows projects list
- [ ] All widgets render without errors
- [ ] State.json reflects accurate status for all repos
- [ ] Final report matches expected format

### Validation Commands

```bash
# Dry run (no changes)
npm run discover -- --dry-run

# Apply changes
npm run apply

# Validate
npm run validate
```

---

## Rollback Strategy

### Per-Repo Rollback
```bash
# Revert last commit with tracking changes
git revert HEAD --no-edit

# Or manually remove:
# 1. Delete analytics.config.json
# 2. Remove GTM snippet from HTML files
# 3. Reset state.json entry
```

### Full Rollback
```bash
# Use state.json to identify all modified repos
# For each repo, revert tracking commits
# Delete GA4 property (if created fresh) via Admin API
# Delete GTM container (if created fresh) via GTM API
# Undeploy Cloudflare Worker
wrangler delete <worker-name>
```

### State Recovery
```bash
# Restore state.json from backup
cp state/state.json.backup state/state.json
```

---

## Final Reporting Format

When `run --apply` completes, output exactly:

```
TOTAL_REPOS_SCANNED=###
TOTAL_ELIGIBLE_REPOS=###
EXCLUDED_PASSIVE_CLONES=###
ALREADY_IMPLEMENTED=###
NET_NEW_IMPLEMENTED=###
DRIFT_REPAIRED=###
FAILED=###
DASHBOARD_VALIDATION=PASS|FAIL
REPORT_JSON_PATH=reports/latest.json
```

The JSON report includes detailed per-repo status, errors, and timestamps.

---

## Failure Handling

- **Continue-on-error**: Process continues even if individual repos fail
- **Failure summary**: All failed repos listed at end with error messages
- **Retry logic**: Transient API errors retried up to 3 times with exponential backoff
- **Partial state**: State.json updated incrementally to preserve progress

---

## Commands

```bash
# Discovery (list + classify repos)
npm run discover

# Dry run (simulate all actions)
npm run apply -- --dry-run

# Apply changes
npm run apply

# Validate
npm run validate

# Full run with custom config
npm run apply -- --config config/brand.prod.json
```
