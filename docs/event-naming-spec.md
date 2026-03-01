# Event Naming Specification

This document defines the event naming conventions and data model for the Personal Brand Analytics platform.

## Event Types

### Page View Event (Automatic)

Triggered automatically on every page load via GTM.

| Field | Type | Description |
|-------|------|-------------|
| event_name | string | `brand_page_view` (auto-set by GTM) |
| project_key | string | Identifier for the project/repo |
| page_location | string | Full URL of the page |
| page_title | string | Title of the page |
| page_referrer | string | Referrer URL |

### Engagement Event (Manual)

Triggered when user interacts meaningfully with content.

```javascript
gtag('event', 'brand_engagement', {
  'project_key': 'my-project',
  'engagement_type': 'scroll_depth',
  'engagement_value': '50'  // percentage
});
```

| Field | Type | Description |
|-------|------|-------------|
| event_name | string | `brand_engagement` |
| project_key | string | Identifier for the project/repo |
| engagement_type | string | Type: `scroll_depth`, `time_on_page`, `click`, `form_interaction` |
| engagement_value | string | Value associated with engagement |

### Project Interaction Event (Manual)

Triggered for specific project actions.

```javascript
gtag('event', 'brand_project_interaction', {
  'project_key': 'my-project',
  'interaction_type': 'repo_link_click',
  'interaction_target': 'github'
});
```

| Field | Type | Description |
|-------|------|-------------|
| event_name | string | `brand_project_interaction` |
| project_key | string | Identifier for the project/repo |
| interaction_type | string | Type: `repo_link_click`, `demo_click`, `external_link` |
| interaction_target | string | Target: `github`, `demo`, `docs`, `npm`, etc. |

## Custom Dimensions

### project_key (Event-scoped)

Identifies which project/repo the hit belongs to.

| Property | Value |
|----------|-------|
| Dimension Name | `project_key` |
| Scope | EVENT |
| Parameter Name | `project_key` |
| Data Type | TEXT |

### repo_name (Event-scoped)

Full GitHub repository name.

| Property | Value |
|----------|-------|
| Dimension Name | `repo_name` |
| Scope | EVENT |
| Parameter Name | `repo_name` |
| Data Type | TEXT |

### page_category (Event-scoped)

Category of page (home, docs, about, etc.).

| Property | Value |
|----------|-------|
| Dimension Name | `page_category` |
| Scope | EVENT |
| Parameter Name | `page_category` |
| Data Type | TEXT |

## Project Key Rules

Project keys are determined in this order:

1. **Config File (Priority 1)**: `project_key` from `analytics.config.json`
2. **Repo Name from Path (Priority 2)**: Inferred from GitHub Pages path `/<repo-name>/`
3. **Hostname Mapping (Priority 3)**: Custom domain mapping from config

Example config for hostname mapping:

```json
{
  "tracking": {
    "project_key_rules": [
      {
        "type": "hostname_mapping",
        "rules": {
          "portfolio.example.com": "main-portfolio",
          "blog.example.com": "blog",
          "docs.example.com": "documentation"
        }
      }
    ]
  }
}
```

## Data Layer Schema

```javascript
window.dataLayer = window.dataLayer || [];

// Recommended dataLayer pushes
dataLayer.push({
  'event': 'brand_page_view',
  'project_key': 'my-project',
  'page_category': 'home'
});

dataLayer.push({
  'event': 'brand_engagement',
  'project_key': 'my-project',
  'engagement_type': 'scroll_depth',
  'engagement_value': '75'
});
```

## Best Practices

1. **Always include project_key**: Every event should have a project_key for proper attribution.

2. **Use consistent naming**: Project keys should be lowercase, hyphenated: `my-project-name`

3. **Avoid PII**: Never send personal information in event parameters.

4. **Test with debug mode**: Enable GA4 debug mode during development:
   ```javascript
   gtag('config', 'G-XXXXXXXXXX', { 'debug_mode': true });
   ```

5. **Respect user privacy**: Implement consent mode if required by your jurisdiction.
