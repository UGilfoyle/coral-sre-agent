import React from 'react';
import { Zap, Bot, Plug, CheckCircle2, Circle, Layers } from 'lucide-react';

export interface DemoStatus {
  ready: boolean;
  connectedCount: number;
  totalProviders: number;
  neonConnected: boolean;
  sandboxRowCount: number;
  flagshipPrompt: string;
  providers: { provider: string; status: string; connected: boolean }[];
}

interface DemoSetupPanelProps {
  demoStatus: DemoStatus | null;
  loading: boolean;
  bootstrapping: boolean;
  onBootstrap: () => void;
  onRunInvestigation: (prompt: string) => void;
  onOpenIntegrations: () => void;
}

export function DemoSetupPanel({
  demoStatus,
  loading,
  bootstrapping,
  onBootstrap,
  onRunInvestigation,
  onOpenIntegrations
}: DemoSetupPanelProps) {
  const ready = demoStatus?.ready ?? false;
  const connected = demoStatus?.connectedCount ?? 0;
  const total = demoStatus?.totalProviders ?? 5;

  return (
    <div className="demo-setup-panel card">
      <div className="demo-setup-panel__header">
        <div className="demo-setup-panel__title">
          <Layers size={18} />
          <span>Quick start</span>
        </div>
        <span className={`badge ${ready ? 'badge--success' : 'badge--warning'}`}>
          {ready ? 'Ready' : `${connected}/${total} sources`}
        </span>
      </div>

      <p className="demo-setup-panel__desc">
        Load the sample payment-service outage scenario across PagerDuty, Sentry, GitHub, Slack, and Jira
        in sandbox mode — no API keys required.
      </p>

      <div className="demo-setup-steps">
        <div className={`demo-setup-step ${ready ? 'demo-setup-step--done' : ''}`}>
          {ready ? <CheckCircle2 size={16} /> : <Circle size={16} />}
          <span>Connect all integrations (sandbox)</span>
        </div>
        <div className="demo-setup-step">
          <Bot size={16} />
          <span>Run AI investigation with cross-source correlation</span>
        </div>
        <div className="demo-setup-step">
          <Zap size={16} />
          <span>Review timeline, root cause, and SQL evidence</span>
        </div>
      </div>

      {demoStatus && !demoStatus.neonConnected && (
        <div className="demo-setup-panel__warn">
          Database offline — using local Coral JSONL. Set <code>DATABASE_URL</code> in <code>.env</code> for
          full persistence.
        </div>
      )}

      {demoStatus && demoStatus.neonConnected && demoStatus.sandboxRowCount === 0 && connected > 0 && (
        <div className="demo-setup-panel__warn">
          Sandbox connected but no rows found. Run <code>pnpm seed</code> once, then load the demo environment
          again.
        </div>
      )}

      <div className="demo-setup-panel__actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onBootstrap}
          disabled={loading || bootstrapping}
        >
          <Plug size={14} />
          {bootstrapping ? 'Loading…' : ready ? 'Refresh demo data' : 'Load demo environment'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onRunInvestigation(demoStatus?.flagshipPrompt || '')}
          disabled={!ready || bootstrapping}
          title={!ready ? 'Load demo environment first' : 'Run sample investigation'}
        >
          <Bot size={14} />
          Run sample investigation
        </button>
        <button type="button" className="btn btn-ghost" onClick={onOpenIntegrations}>
          Integration Hub
        </button>
      </div>

      {demoStatus && demoStatus.providers.length > 0 && (
        <div className="demo-setup-providers">
          {demoStatus.providers.map((p) => (
            <span
              key={p.provider}
              className={`demo-setup-provider-chip ${p.connected ? 'demo-setup-provider-chip--on' : ''}`}
            >
              {p.provider}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
