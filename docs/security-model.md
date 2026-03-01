# Security Model

This document describes the security architecture and best practices for the Personal Brand Analytics platform.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Pages Dashboard                   │
│                     (Public, Client-side)                    │
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐ │
│  │  Chart.js    │────▶│   app.js     │────▶│  fetch()     │ │
│  └──────────────┘     └──────────────┘     └──────────────┘ │
│                                                │              │
└────────────────────────────────────────────────┼──────────────┘
                                                 │ HTTPS
                                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare Worker Proxy                     │
│                  (Secure Backend)                            │
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐ │
│  │  CORS Auth   │────▶│  JWT Sign    │────▶│  GA4 API     │ │
│  └──────────────┘     └──────────────┘     └──────────────┘ │
│                                                │              │
│  ┌──────────────┐                              │              │
│  │  Secrets     │◀─────────────────────────────┤              │
│  │  (Encrypted) │                              │              │
│  └──────────────┘                              │              │
└────────────────────────────────────────────────┼──────────────┘
                                                 │ HTTPS
                                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  Google Analytics 4 API                      │
│                  (OAuth 2.0 Protected)                       │
└─────────────────────────────────────────────────────────────┘
```

## Authentication Methods

### GitHub Authentication

| Method | Purpose | Storage |
|--------|---------|---------|
| Personal Access Token (Classic) | Repo access, API calls | Environment variable `GITHUB_TOKEN` |
| OAuth App (optional) | User authentication | Not stored (session-based) |

**Required Scopes:**
- `repo` - Full control of private repositories
- `read:user` - Read user profile data
- `user:email` - Read email addresses

**Security Notes:**
- Never commit tokens to Git
- Use fine-grained tokens when possible
- Rotate tokens periodically
- Store in `.env` (gitignored) or secret manager

### Google Authentication

| Method | Purpose | Storage |
|--------|---------|---------|
| Service Account | Server-to-server API access | `GOOGLE_APPLICATION_CREDENTIALS` |
| OAuth 2.0 (User) | Admin operations | OAuth token (session) |

**Required Scopes:**
- `https://www.googleapis.com/auth/analytics.edit` - GA4 management
- `https://www.googleapis.com/auth/analytics.readonly` - GA4 data access
- `https://www.googleapis.com/auth/tagmanager.manage.users` - GTM management

**Security Notes:**
- Service account should have minimal required permissions
- Limit service account access to specific GA4 properties
- Rotate service account keys every 90 days
- Use workload identity federation where possible

### Cloudflare Authentication

| Method | Purpose | Storage |
|--------|---------|---------|
| API Token | Worker deployment | `CLOUDFLARE_API_TOKEN` |
| Worker Secrets | GA4 credentials | Encrypted at rest |

**Required Permissions:**
- `Cloudflare Workers:Edit` - Deploy workers
- `Cloudflare Workers:Write` - Update worker code

**Security Notes:**
- Use API tokens (not global API key)
- Scope tokens to minimum required permissions
- Worker secrets are encrypted and never exposed in code

## Secret Storage

### Local Development (.env)

```bash
# .env (NEVER commit this file)
GITHUB_TOKEN=ghp_xxxx
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
CLOUDFLARE_API_TOKEN=xxxx
CLOUDFLARE_ACCOUNT_ID=xxxx
```

### Production (Environment/Secret Manager)

| Platform | Secret Store |
|----------|-------------|
| GitHub Actions | Repository/Environment secrets |
| Cloudflare Workers | Worker secrets (encrypted) |
| CI/CD | Vault, AWS Secrets Manager, etc. |

### Cloudflare Worker Secrets

```bash
# Set secrets (values are encrypted at rest)
wrangler secret put GA4_CREDENTIALS --name brand-analytics-proxy
wrangler secret put GA4_MEASUREMENT_ID --name brand-analytics-proxy
```

## Data Protection

### In Transit

- All communication uses HTTPS/TLS 1.3
- HSTS enabled on Cloudflare
- Certificate pinning recommended for mobile

### At Rest

- Worker secrets encrypted with Cloudflare's key management
- State files contain no sensitive data (only IDs and timestamps)
- No credentials stored in GitHub repositories

### Data Minimization

The dashboard only displays:
- Aggregated metrics (counts, percentages)
- Anonymized geographic data (country level)
- No user-level or session-level data exposed

## CORS Configuration

The Worker implements strict CORS:

```javascript
const allowedOrigins = (ALLOWED_ORIGINS || '').split(',');

if (origin && allowedOrigins.includes(origin)) {
  headers['Access-Control-Allow-Origin'] = origin;
} else {
  headers['Access-Control-Allow-Origin'] = 'https://your-username.github.io';
}
```

**Configuration:**
```json
{
  "serverless_proxy": {
    "allowed_origins": [
      "https://your-username.github.io",
      "https://your-custom-domain.com"
    ]
  }
}
```

## Rate Limiting

The Worker implements rate limiting to prevent abuse:

```javascript
// Example rate limiting (implement with Cloudflare KV)
const rateLimit = {
  requests: 100,
  window: 60 // seconds
};
```

## Audit Logging

All automation runs log:
- Timestamp
- Actions taken
- Repositories modified
- Errors encountered

Logs stored in: `reports/YYYY-MM-DD-run.json`

## Incident Response

### If a Token is Compromised

1. **GitHub Token:**
   - Revoke immediately: `gh auth refresh`
   - Generate new token
   - Update secret stores

2. **Google Service Account:**
   - Revoke key in Google Cloud Console
   - Generate new key
   - Update secret stores

3. **Cloudflare API Token:**
   - Revoke in Cloudflare Dashboard
   - Generate new token
   - Update secret stores

### If Worker is Compromised

1. Immediately rotate all Worker secrets
2. Review Worker code for unauthorized changes
3. Check Cloudflare audit logs
4. Consider deploying new Worker with new name

## Compliance Considerations

### GDPR

- Implement consent mode if serving EU users
- Provide data deletion mechanism
- Document data processing activities

### CCPA

- Provide opt-out mechanism
- Document data sales (if any - typically none for analytics)

### Privacy Shield

- Use Standard Contractual Clauses for EU-US data transfer
- GA4 has EU data processing addendum

## Security Checklist

- [ ] All tokens stored in environment variables/secrets
- [ ] No credentials in code or config files
- [ ] CORS properly configured
- [ ] HTTPS enforced everywhere
- [ ] Service accounts have minimal permissions
- [ ] Tokens rotated periodically
- [ ] Audit logging enabled
- [ ] Incident response plan documented
