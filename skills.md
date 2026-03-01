# Personal Brand Analytics Automation Skill

## Purpose/Summary

This skill automates the deployment and management of a unified analytics tracking system across all eligible GitHub repositories. It is designed to be **re-run months later** and will only apply changes to newly eligible repos while testing that builds are not broken.

**Key Features:**
- Idempotent: Safe to re-run anytime; skips already-processed repos
- **Test-Before-Push:** Runs build/tests before pushing to avoid breaking repos
- Zero-touch: Fetches data and updates dashboard automatically
- Uses only free services: GA4 (free), GitHub Actions (free), GitHub Pages (free)

---

## Inputs

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--config` | string | `config/brand.config.json` | Path to configuration file |
| `--dry-run` | boolean | `false` | Simulate actions without making changes |
| `--apply` | boolean | `false` | Execute all automation steps |
| `--validate` | boolean | `false` | Run validation tests only |
| `--skip-tests` | boolean | `false` | Skip build testing (NOT recommended) |
| `--force` | boolean | `false` | Force re-process all repos |

---

## Tools Required

- **GitHub CLI/API**: `gh` (must be authenticated)
- **Google APIs**: GA4 Data API (via OAuth2)
- **Node.js**: v18+ for scripts
- **Git**: For repository operations

---

## Authentication Requirements

### GitHub
```bash
gh auth login --scopes repo,read:user,user:email
export GITHUB_TOKEN=$(gh auth token)
```

### Google (GA4)
```bash
npm run auth:ga4
```
This creates `.ga4-token.json` with refresh token.

---

## Step-by-Step Procedure

### Phase 1: Discovery (Run Every Time)
1. Fetch all repositories via GitHub API
2. Classify each repo:
   - **CORE_PROJECT**: `fork == false` AND (has_pages OR deployable structure)
   - **ACTIVE_CONTRIBUTION**: `fork == true` AND (PRs or commits by me > 0)
   - **PASSIVE_CLONE**: `fork == true` AND no activity (excluded)
3. Filter by config: `force_include_repos`, `force_exclude_repos`
4. Compare with `state/state.json` to find net-new repos

### Phase 2: GA4 + GTM Setup (One-Time)
1. Use existing GA4 property from config: `ga4.property_id_optional`
2. Use existing GTM container from config: `gtm.container_id_optional`
3. Verify GA4 custom dimension `project_key` exists
4. Create if missing (requires Google API access)

### Phase 3: Repo Implementation (With Testing)

For each **net-new eligible repo**:

1. **Clone repo** to local cache
2. **Detect site type**:
   - Static HTML (index.html, docs/index.html)
   - Jekyll (_config.yml)
   - Hugo (config.toml, hugo.toml)
   - Astro (astro.config.js)
   - Vite (vite.config.js + package.json)
   - Next.js (next.config.js)
   - NPM project (package.json)
3. **Inject GTM snippet** into HTML files (after `<head>`)
4. **Create `analytics.config.json`** with project_key
5. **TEST BEFORE PUSH** (Critical):
   - Run build command if site has build step
   - Validate HTML structure
   - Run `npm audit` for npm projects
   - **If tests fail**: Revert changes, report error, skip repo
6. **Push changes** (only if tests pass):
   - Create branch: `add-analytics-tracking`
   - Commit: `chore: Add analytics tracking [brand-analytics-automation]`
   - Push to GitHub
   - PR URL provided for review
7. **Coverage validation**:
   - Validate GTM container ID + GA4 measurement ID on all HTML pages in processed repos
   - Record summary in `reports/final-validation.json`

### Phase 4: Dashboard Update (Automatic)

1. Update `dashboard/projects.json` with all tracked projects
2. **GitHub Actions** (scheduled daily at 6 AM UTC):
   - Fetch fresh GA4 data using stored OAuth token
   - Generate `data-7days.json`, `data-30days.json`, `data-90days.json`
   - Deploy to GitHub Pages (gh-pages branch)
3. Dashboard live at: `https://<username>.github.io/brand-analytics-dashboard/`
4. Repo sync workflow (`.github/workflows/sync-repos.yml`) runs daily and can be dispatched manually

### Phase 5: Validation (Final Check)

1. Verify state.json updated
2. Print final report with counts
3. List failed repos with reasons
4. Run `npm run validate:final` to verify:
   - eligible repos have tracking installed
   - all HTML pages in processed repos include GTM and GA4 IDs
   - dashboard project count equals installed repo count

---

## Idempotency Rules

| Condition | Action |
|-----------|--------|
| `analytics.config.json` exists | Skip config creation |
| GTM snippet with matching ID found | Skip injection |
| State shows `tracking_installed=true` | Skip unless drift detected |
| State shows `test_failed=true` | Skip (manual review needed) |
| **Re-run after 3 months** | Only process NEW repos |

**Drift Detection**: If GTM snippet removed, skill re-injects (after tests pass).

---

## Testing Strategy (Critical)

### Site Type Detection & Tests

| Site Type | Detects By | Build Command | Tests |
|-----------|------------|---------------|-------|
| Static HTML | index.html exists | None | HTML validity, GTM placement |
| Jekyll | _config.yml | `bundle exec jekyll build` | Build success |
| Hugo | config.toml | `hugo` | Build success |
| Astro | astro.config.js | `npm run build` | Build success |
| Vite | vite.config.js | `npm run build` | Build success |
| Next.js | next.config.js | `npm run build` | Build success |
| NPM project | package.json | `npm install` | npm audit |

### Test Failure Handling

If tests fail:
1. **Revert all changes** in the repo clone
2. **Do NOT push** to GitHub
3. Record failure in state.json: `errors: ["Build test failed: ..."]`
4. Mark as `test_failed` (requires manual review)
5. Continue to next repo

### Skip Tests (Not Recommended)

```bash
npm run apply -- --skip-tests
```

Only use for repos where you're certain changes are safe.

---

## Validation Plan

### Acceptance Criteria

- [ ] No repos have broken builds after skill runs
- [ ] All CORE_PROJECT repos have GTM snippet (or test_failed recorded)
- [ ] State.json accurately reflects all repos
- [ ] Dashboard shows updated project list
- [ ] Final report matches expected format

### Final Report Format

```
TOTAL_REPOS_SCANNED=###
TOTAL_ELIGIBLE_REPOS=###
EXCLUDED_PASSIVE_CLONES=###
ALREADY_IMPLEMENTED=###
NET_NEW_IMPLEMENTED=###
DRIFT_REPAIRED=###
TEST_FAILED=###
FAILED=###
DASHBOARD_VALIDATION=PASS|FAIL
REPORT_JSON_PATH=reports/latest.json
```

---

## Rollback Strategy

### Per-Repo Rollback
```bash
# If tests fail, changes are auto-reverted

# Manual revert if needed:
cd <repo-path>
git revert HEAD --no-edit  # Revert last tracking commit
```

### Per-Repo PR Close
If PR was created but not merged:
1. Go to PR URL from report
2. Close PR without merging

### State Recovery
```bash
# Restore previous state
cp state/state.json.backup state/state.json
```

---

## Failure Handling

| Error Type | Handling |
|------------|----------|
| Build test failed | Revert changes, record in state.json, continue |
| Push failed (no write access) | Record as `committed_local`, provide manual steps |
| API rate limit | Retry with exponential backoff (3 attempts) |
| GA4 auth expired | Report error, user must re-run `npm run auth:ga4` |
| Clone failed | Record error, continue to next repo |

---

## Commands

```bash
# Full run: discover + apply + test + push
npm run apply

# Dry run (preview what would happen)
npm run apply -- --dry-run

# Force re-process all repos (ignores state)
npm run apply -- --force

# Skip tests (NOT recommended)
npm run apply -- --skip-tests

# Validate only
npm run validate

# Final UI/count/tag validation
npm run validate:final

# Fetch fresh GA4 data (for dashboard)
npm run fetch:data

# Authorize Google (if token expired)
npm run auth:ga4
```

---

## Usage for Future Agents

```bash
# Clone repo
git clone https://github.com/arvind3/brand-analytics-automation.git
cd brand-analytics-automation
npm install

# Ensure auth
gh auth login --scopes repo,read:user,user:email
export GITHUB_TOKEN=$(gh auth token)
npm run auth:ga4

# Run skill
npm run apply
```

**Re-run after months:**
```bash
# Same commands - skill detects what's new
npm run apply
```

The skill automatically:
- Skips already-processed repos
- Only applies changes to NEW repos created since last run
- Tests each repo before pushing
- Updates dashboard with latest GA4 data

---

## Output Files

| File | Purpose |
|------|---------|
| `state/state.json` | Tracks all repos, changes, test results |
| `reports/latest.json` | Detailed run report |
| `dashboard/projects.json` | Tracked projects list |
| `dashboard/data-*.json` | GA4 analytics data (generated by Actions) |
| `.ga4-token.json` | OAuth refresh token (gitignored) |

---

## Example: Re-run After 3 Months

```bash
# 1. Pull latest code
git pull origin main

# 2. Ensure auth
gh auth login
npm run auth:ga4

# 3. Dry run first
npm run apply -- --dry-run

# Output preview:
# TOTAL_REPOS_SCANNED=52  (was 49, +3 new)
# TOTAL_ELIGIBLE_REPOS=20  (was 18, +2 new)
# ALREADY_IMPLEMENTED=18   (previously done)
# NET_NEW_IMPLEMENTED=2    (new repos to process)

# 4. Apply (with tests)
npm run apply

# 5. Review report
cat reports/latest.json
```

---

## Dashboard Behavior

The dashboard at `https://arvind3.github.io/brand-analytics-dashboard/`:

1. **Auto-updates daily** via GitHub Actions (6 AM UTC)
2. **Fetches real GA4 data** on page load (from pre-generated JSON)
3. **Shows all tracked repos** with their analytics
4. **No backend required** - static site with GA4 API integration

### Manual Refresh

```bash
# Trigger dashboard update immediately
gh workflow run dashboard-update.yml --repo arvind3/brand-analytics-automation
```

Or via GitHub UI: https://github.com/arvind3/brand-analytics-automation/actions/workflows/dashboard-update.yml

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Test pass rate | 100% (no broken builds) |
| New repos processed | All eligible net-new |
| Dashboard uptime | 99% (GitHub Pages) |
| Data freshness | < 24 hours (daily updates) |
