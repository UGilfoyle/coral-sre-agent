# Coral SRE 🐚

> **Secure, Multi-Tenant SRE Incident Investigation & Advisory Platform**
> Fully powered by Coral — the open-source secure data retrieval engine.

---

### 🚀 The SRE Reality
When a production outage occurs, operations and engineering teams waste critical minutes manually cross-referencing fragmented data across **PagerDuty, Sentry, GitHub, Slack, ServiceNow, and Confluence**. 

**Coral SRE resolves incidents in one query.** By translating complex, polyglot microservice telemetry into unified relational SQL schemas, Coral SRE correlates alerts, commits, exceptions, and runbooks instantly and securely.

---

## ✨ Key Capabilities

* **🔒 Zero-Trust Tenant Isolation**
  Built on a secure control plane enforcing strict Postgres Row-Level Security (RLS) to ensure complete workspace data isolation.
* **🛡️ Encrypted SaaS Credentials**
  Enforces industry-standard AES-256-GCM token encryption for third-party integrations (PagerDuty, Sentry, Jira, Slack).
* **🧠 AI-Native Incident Correlation**
  An intelligent query-routing agent that parses natural language questions, translates them into secure multi-table SQL queries, and produces structured timelines and remediation playbooks.
* **⚡ Dynamic Telemetry Offsetting**
  Our proprietary relative clock service automatically shifts incident telemetry relative to **exactly right now** on bootstrap—providing a flawless live demonstration experience.
* **📊 Lang-Agnostic Correlation**
  Seamlessly indexes exception telemetry, CI pipeline logs, and Git diffs across diverse programming languages (Python, Go, Node, Rust) into clean, standard tables.

---

## 🛠️ Tech Stack & Architecture

* **Frontend**: React 18, Vite 5, Tailwind-equivalent Harmonic CSS
* **Backend**: Express BFF Gateway (Node.js 20+ / TypeScript)
* **Storage Layer**: Neon Multi-Tenant Postgres Cloud
* **Data Engine**: Coral SQL Layer & Secure Proxy CLI

---

## 🚀 Quick Start (Demo Mode)

Spin up the entire secure environment in three quick steps:

```bash
# 1. Install Dependencies
pnpm install

# 2. Initialize Telemetry Specs
pnpm run setup

# 3. Start the Platform
pnpm run dev
```

* **Frontend Dashboard**: `http://localhost:3000`
* **Secure Backend API**: `http://localhost:3001`

---

## 🔒 Security & Safety Defaults

Coral SRE is built with security first:
1. **SQL Guard Middleware**: Proactively parses all incoming queries against an AST validator to block SQL injections and unauthorized schema operations.
2. **Per-Tenant Rate-Limiters**: Enforces strict API quotas on expensive AI agent invocations.
3. **Vault Separation**: Decrypts SaaS tokens purely in-memory during sync cycles, never caching raw credentials.
