# SRE Platform Database & Adaptability Guide 🐚

This guide explains the underlying **Database Architecture** of the **Coral AI Bot** platform and provides instructions on how to **adapt this platform for your own customized service schemas** or **connect to real production SaaS tools**!

---

## 1. What is the Database?

Our platform utilizes **Coral** as a high-performance **federated data retrieval layer** that runs standard SQL queries locally. 

Instead of requiring complex Postgres/MySQL server setups, our local database is backed by **JSON Lines (JSONL)** text files. The schema definitions are declared in standard **YAML files** located under the `coral-sources/` folder.

When you execute queries:
1. Coral maps the YAML schemas to the underlying JSONL datasets.
2. It parses and executes standard ANSI SQL projections, selections, aggregates, and **cross-source JOINs** in memory.
3. It exposes virtual database introspection tables `coral.tables` and `coral.columns` for runtime schema discovery!

---

## 2. Core SRE Database Schemas

Here are the 8 active tables structured within our SRE data ecosystem:

### GitHub Builds (`github.builds`)
Stores CI/CD pipeline runs and workflow logs.
- `id` (Utf8) - Build ID
- `workflow_name` (Utf8) - Name of CI process
- `commit_sha` (Utf8) - Git Commit Hash
- `branch` (Utf8) - Code Branch
- `status` (Utf8) - success / failed
- `trigger_time` (Utf8) - ISO Timestamp
- `duration_seconds` (Int64) - Workflow runtime
- `error_log` (Utf8) - Stack traces or test failure snippets
- `triggered_by` (Utf8) - Developer or webhook trigger

### Sentry Errors (`sentry.errors`)
Stores application crash exceptions and error levels.
- `id` (Utf8) - Sentry Issue ID
- `issue_id` (Utf8) - Code Error ID (e.g. SENTRY-PAY-41A)
- `message` (Utf8) - Error details and TypeError snippets
- `status` (Utf8) - unresolved / resolved
- `level` (Utf8) - fatal / error / warning
- `first_seen` (Utf8) - ISO Timestamp
- `last_seen` (Utf8) - ISO Timestamp
- `count` (Int64) - Cumulative occurrences
- `metadata__culprit` (Utf8) - Culprit file or function trace
- `stack_trace` (Utf8) - Detailed crash trace

### Slack SRE threads (`slack.threads`)
Incident discussions under `#incidents` channel.
- `id` (Utf8) - Message ID
- `channel` (Utf8) - SRE Channel name
- `ts` (Utf8) - Message ISO Timestamp
- `user` (Utf8) - Username or bot name
- `text` (Utf8) - Discussion content
- `replies_count` (Int64) - Number of comments in thread
- `replies` (Utf8) - Thread content string

### PagerDuty Incidents (`pagerduty.incidents`)
Active SRE alerting notifications.
- `id` (Utf8) - Incident ID (e.g. PD-5501)
- `title` (Utf8) - Alert description
- `status` (Utf8) - triggered / acknowledged / resolved
- `urgency` (Utf8) - high / low
- `created_at` (Utf8) - Alert trigger ISO Timestamp
- `service_name` (Utf8) - Service experiencing issues
- `assignee` (Utf8) - SRE engineer on-call

### Deployments history (`deployments.history`)
Deployments log across all microservices.
- `id` (Utf8) - Deployment identifier
- `service` (Utf8) - Service name
- `version` (Utf8) - App version
- `status` (Utf8) - success / failed
- `deployed_at` (Utf8) - Release ISO Timestamp
- `changelog` (Utf8) - Commit descriptions or rollback comments
- `deployed_by` (Utf8) - Engineer or pipeline

### Enterprise Ticketing (`enterprise.tickets`)
Unified boards tracking corporate tickets.
- `id` (Utf8) - Ticket ID (e.g. JIRA-1024, LINEAR-89)
- `board` (Utf8) - Ticket platform (Jira / Azure Boards / ClickUp / Linear)
- `title` (Utf8) - Task summary
- `status` (Utf8) - To Do / In Progress / Done
- `priority` (Utf8) - P0 / P1 / P2
- `assignee` (Utf8) - Engineering owner
- `service` (Utf8) - Target service name
- `created_at` (Utf8) - Ticket creation date

### Change Advisory Board (`enterprise.change_requests`)
ServiceNow Change Requests (CHG) auditing logs.
- `id` (Utf8) - Change Request identifier
- `system` (Utf8) - ServiceNow / CAB
- `service` (Utf8) - Targeted service
- `version` (Utf8) - Target release version
- `status` (Utf8) - Approved / Rejected_CAB / Approved_Emergency
- `requester` (Utf8) - Deployer or developer name
- `scheduled_at` (Utf8) - Scheduled window
- `risk_level` (Utf8) - High / Medium / Low

### Confluence Wikis (`enterprise.knowledge_base`)
Resolution runbooks and troubleshooting guides.
- `id` (Utf8) - Page ID
- `platform` (Utf8) - Confluence / Notion / Wiki
- `title` (Utf8) - Document title
- `service` (Utf8) - Service identifier
- `runbook_steps` (Utf8) - Playbook markdown detailing recovery guides
- `last_updated_at` (Utf8) - Last edit date

---

## 3. How to Adapt the Schemas for Your Services

If you want to use this SRE platform for **your own microservices or custom schemas**, follow these 3 simple steps:

### Step 1: Customize Your Datasets
Open the JSONL mock databases under `src/backend/data/` and add or modify the JSON lines to match your own actual services (e.g., replace `payment-service` with `cart-service` or `billing-api`).

### Step 2: Adapt the Columns & Types
If your internal telemetry or deployments schema differs from our columns, simply update the corresponding table columns and types inside the YAML specs in `coral-sources/`:
```yaml
# Add or rename columns under the table definition
columns:
  - name: new_telemetry_metric
    type: Utf8
  - name: system_cpu_utilization
    type: Double
```
Source specs in `coral-sources/` use the `__CORAL_DATA_URI__` placeholder (never commit machine-specific `file://` paths). Running setup generates resolved YAML under `.coral-generated/` and registers them with the Coral CLI:
```bash
pnpm run setup
```

### Step 3: Align SRE Investigator AI Agent (`agent.ts`)
Open `src/backend/agent.ts` and customize `SERVICE_NAMES` to list your own microservice names:
```typescript
const SERVICE_NAMES = ['billing-api', 'cart-service', 'inventory-db'];
```
Update the dynamic SQL queries inside `queryDeployments`, `queryErrors`, etc., to use your custom columns.

---

## 4. How to Connect Real Live Production SaaS APIs

To turn this platform from a local local SRE playground into a **live production SRE center**, you can easily swap Coral's local file-backed tables for **live API connections** to Sentry, PagerDuty, Jira, ServiceNow, Slack, and GitHub!

Coral has native SaaS integrations that let you query live APIs with SQL. To switch:

### 1. Update the YAML Source specs
Instead of a `backend: jsonl` file provider, update the source specs in `coral-sources/` to connect to Coral's production adapters.

#### Live GitHub Integration:
```yaml
name: github
version: 1.0.0
backend: github
config:
  token: ${ENV.GITHUB_PERSONAL_ACCESS_TOKEN}
  organization: "your-company-org"
tables:
  - name: builds
    description: Live workflow runs
    # Coral queries the live GitHub Actions API under the hood when you run SQL!
```

#### Live Jira Integration:
```yaml
name: enterprise
version: 1.0.0
backend: jira
config:
  domain: "your-company.atlassian.net"
  email: "sre@your-company.com"
  api_token: ${ENV.JIRA_API_TOKEN}
tables:
  - name: tickets
    description: Live Jira Issues
```

### 2. Export Your API Keys
In your production environment, export the required tokens:
```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
export JIRA_API_TOKEN="ATATT..."
```

### 3. Re-Register Sources
Re-run the setup script:
```bash
pnpm run setup
```
Now, whenever the SRE Copilot or SQL Console runs a query, **Coral will fetch telemetry, CAB statuses, Confluence runbooks, and tickets from your actual live production systems in real time!**
