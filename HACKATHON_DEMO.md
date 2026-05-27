# Hackathon Demo Script (3 minutes)

## Before the presentation

```bash
pnpm install
cp .env.example .env   # add DATABASE_URL from Neon
pnpm seed              # once
pnpm run setup         # once
pnpm dev               # frontend :3000 + API :3001
```

## Live demo flow

1. **Login** — Click **Continue with Google SSO** (auto-fills demo user).
2. **Load demo** — On **Incident Overview**, click **Load demo environment** (connects all 5 integrations with sandbox data).
3. **Investigate** — Click **Run flagship investigation** (payment-service outage scenario).
4. **Show results** — Point judges to the right panel:
   - Cross-source SQL evidence
   - Incident timeline (deploy → errors → rollback)
   - Root cause + resolution
5. **Optional** — Open **Investigation History** to show persistence.
6. **Optional** — **Integration Hub** → show AES-encrypted vault + Sandbox vs Live modes.
7. **Optional** — **SQL Workspace** → run a live Coral join query.

## Flagship prompt (built-in)

> Investigate the current production outage. Correlate PagerDuty incidents with recent deployments and Sentry errors.

## Story to tell judges

- **Problem**: SREs waste hours correlating PagerDuty, Sentry, GitHub, Slack, and Jira during outages.
- **Solution**: Coral unified SQL + tenant-aware AI agent finds root cause in one query.
- **Demo data**: Realistic payment-service v2.4.1 deploy failure → cascade → rollback narrative.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| API Offline badge | Run `pnpm dev`, ensure port 3001 is free |
| Login JSON error | Backend not running |
| Investigation: no data sources | Click **Load demo environment** |
| Sandbox 0 rows | Run `pnpm seed`, reconnect demo |
