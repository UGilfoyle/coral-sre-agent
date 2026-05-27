# Coral AI Bot 🐚

> An enterprise-grade SRE incident investigation and advisory platform powered by [Coral](https://github.com/withcoral/coral) — the open-source data retrieval layer that lets agents query any API, database, or file as SQL tables.

## What It Does

Coral AI Bot is an **AI SRE Investigator** that solves a real problem for engineering teams: correlating incidents and change advisories across fragmented tools. When a production outage happens, SRE teams waste hours manually cross-referencing PagerDuty alerts, Sentry errors, GitHub CI builds, deployment logs, Slack threads, Jira boards, ServiceNow changes, and Confluence runbooks.

This agent does it in **one query**.

### Core Capabilities

- **Cross-Source Incident Correlation**: Join PagerDuty incidents with deployment history, ServiceNow CAB logs, and Sentry exceptions in a single SQL query to isolate why an outage occurred and whether it was authorized.
- **CI/CD Failure Diagnosis**: Correlate failed GitHub Actions builds with Sentry error stack traces to pinpoint the breaking commit.
- **Auto-Suggested Runbooks**: Extracts troubleshooting playbooks from Confluence or Notion automatically matching the affected service.
- **Automated SRE Notifications**: Dynamically posts automated incident cards back into Slack incident channels as part of the operational loop.
- **Interactive SQL Console**: Direct SQL access to all connected sources with schema introspection via `coral.tables` and `coral.columns`.

---

## 🗃️ Database & Adaptability Architecture

The platform supports a unified SRE database schema spanning **6 sources and 8 tables**:
- **github.builds**: CI/CD runs and workflow statuses.
- **sentry.errors**: Exception crash reports and count metrics.
- **slack.threads**: SRE discussion logs in `#incidents`.
- **pagerduty.incidents**: On-call pager alerts.
- **deployments.history**: Version release histories.
- **enterprise.tickets**: Project management tasks (Jira, Azure Boards, ClickUp, Linear).
- **enterprise.change_requests**: Change Advisory Board (CAB) & ServiceNow Change Request audit logs.
- **enterprise.knowledge_base**: Knowledge runbooks (Confluence, Notion, Wikis).

> [!TIP]
> For a detailed column specification of each table, or guidance on how to **adapt these schemas for your own custom microservices** or connect them to **live production SaaS API keys** (Jira, Sentry, PagerDuty, GitHub), read our **[DATABASE_GUIDE.md](./DATABASE_GUIDE.md)**!

---

## Coral Features Used

| Feature | How We Use It |
|---------|---------------|
| **SQL Interface** | All data queries go through `coral sql --format json` |
| **Cross-Source Joins** | JOIN across 8 different tables in single queries |
| **Schema Learning** | Query `coral.tables` and `coral.columns` for automatic schema introspection in the UI |
| **Caching** | Repeated queries leverage Coral's smart caching for faster responses |
| **Custom Source Specs** | 6 YAML source specs defining JSONL-backed tables with typed columns |
| **MCP Compatible** | All sources are exposed via `coral mcp-stdio` for agent integration |
| **Test Queries** | Each source spec includes validation test queries |
| **Source Linting** | All specs validated with `coral source lint` before installation |

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          React Frontend                                │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Overview  │  │ SQL Console  │  │ SRE Investigator│  │   Sources    │  │
│  │ Dashboard │  │   (Direct)   │  │   (AI Agent)   │  │  Explorer    │  │
│  └─────┬─────┘  └──────┬───────┘  └────────┬───────┘  └──────┬───────┘  │
│        └───────────────┬───────────────────┘                 │         │
├────────────────────────┼─────────────────────────────────────┼─────────┤
│                    Express API Server                                  │
│   /api/query  │  /api/agent  │  /api/schema  │  /api/sources           │
├────────────────────────┼───────────────────────────────────────────────┤
│                  coral sql --format json                               │
├────────────────────────┼───────────────────────────────────────────────┤
│                        Coral Engine                                    │
│  ┌─────────┐ ┌────────┐ ┌───────┐ ┌──────────┐ ┌──────┐ ┌───────────┐  │
│  │ GitHub  │ │ Sentry │ │ Slack │ │PagerDuty │ │Deploy│ │Enterprise │  │
│  │ .builds │ │.errors │ │.thrd  │ │.incidents│ │.hist │ │(Tickets/  │  │
│  │         │ │        │ │       │ │          │ │      │ │ CAB / KB) │  │
│  └────┬────┘ └───┬────┘ └──┬────┘ └────┬─────┘ └──┬───┘ └─────┬─────┘  │
│       └──────────┴─────────┴────────────┴──────────┘           │       │
│                         Local JSONL Files                      │       │
│             (Zero API keys required for quickstart)            │       │
└────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm
- Coral CLI (`brew install withcoral/tap/coral`)

### Setup

```bash
# Clone the project
cd coral-sre-agent

# Install dependencies
pnpm install

# Copy environment template and set DATABASE_URL (never commit .env)
cp .env.example .env

# Initialize Coral sources (generates .coral-generated/ from templates)
pnpm run setup

# Start the application
pnpm run dev
```

The app will be available at:
- **Frontend**: http://localhost:3000
- **API Server**: http://localhost:3001

### Verify Coral Sources

```bash
# List installed sources
coral source list

# Test a cross-source query
coral sql "SELECT p.title, d.version FROM pagerduty.incidents p JOIN deployments.history d ON p.service_name = d.service"
```

### Slack Bot (Phase 4)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Add **OAuth scopes**: `chat:write`, `commands`, `app_mentions:read`, `channels:history`, `channels:read`
3. Enable **Event Subscriptions** → Request URL: `https://YOUR_APP/api/slack/events` (use ngrok locally)
4. Subscribe to bot event: `app_mention`
5. Create slash command `/coral` → Request URL: same events endpoint
6. Set redirect URL: `http://localhost:3001/api/slack/oauth/callback`
7. Add to `.env`:
   ```bash
   SLACK_CLIENT_ID=...
   SLACK_CLIENT_SECRET=...
   SLACK_SIGNING_SECRET=...
   APP_URL=http://localhost:3001
   FRONTEND_URL=http://localhost:3000
   ```
8. In the dashboard → **Integration Hub** → Slack card → **Add to Slack**

**Usage in Slack:**
- `/coral investigate payment-service errors after 16:00`
- `@Coral why did payment-service fail?`

## Demo Scenarios

### 1. Production Outage Investigation
Click "Run AI Investigation" on the dashboard or ask the agent:
> "Investigate the current production outage. Correlate PagerDuty incidents with recent deployments and Sentry errors."

The agent will:
1. Query PagerDuty for triggered high-urgency incidents
2. Cross-join with deployment history to find recent deploys to affected services  
3. Correlate with Sentry errors occurring after the deployment
4. Produce a timeline and root cause analysis

### 2. CI/CD Failure Diagnosis
> "Examine failed CI builds and correlate them with Sentry error logs."

### 3. Post-Rollback Verification
> "Verify the payment-service rollback status and check if all related incidents are resolved."

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vanilla CSS
- **Backend**: Express + TypeScript
- **Data Layer**: Coral (local JSONL-backed sources)
- **Build Tool**: Vite 5
- **Package Manager**: pnpm

## Project Structure

```
coral-sre-agent/
├── coral-sources/          # Coral YAML templates (__CORAL_DATA_URI__ placeholder)
├── .coral-generated/       # Resolved specs (gitignored; created by pnpm run setup)
│   ├── github.yaml
│   ├── sentry.yaml
│   ├── slack.yaml
│   ├── pagerduty.yaml
│   ├── deployments.yaml
│   └── enterprise.yaml     # Tickets, ServiceNow, and Confluence specs
├── src/
│   ├── backend/
│   │   ├── server.ts       # Express API server
│   │   ├── agent.ts        # SRE AI investigation agent
│   │   └── data/           # JSONL datasets (local SRE data)
│   └── frontend/
│       ├── App.tsx          # Main React application
│       ├── main.tsx         # Entry point
│       └── index.css        # Design system
├── scripts/
│   ├── setup.js            # Path portability setup script (pnpm run setup)
│   └── setup-coral.sh      # Legacy source initialization
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## License

MIT
