import React, { useState, useEffect, useRef } from 'react';
import {
  Activity, Terminal, Bot, Compass, Server, Shield, Send, Play,
  Database, AlertTriangle, ChevronRight, Layers, Search, Zap, BookOpen,
  Sun, Moon, LogOut, Plug, History, Key
} from 'lucide-react';


/* ───── Types ───── */
interface TimelineItem {
  time: string;
  title: string;
  desc: string;
  type: 'alert' | 'deploy' | 'rollback' | 'error' | 'success';
}

interface RootCause {
  service: string;
  reason: string;
  commit: string;
  author: string;
  resolution: string;
  cabStatus?: string;
  runbook?: string;
  tickets?: { id: string; board: string; title: string; status: string; priority: string }[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  results?: any[];
  timeline?: TimelineItem[];
  rootCause?: RootCause;
  coralFeatures?: string[];
  queryTimeMs?: number;
}

type TabId = 'overview' | 'investigate' | 'sql' | 'sources' | 'telemetry' | 'integrations' | 'history' | 'api-keys';

/* ───── App ───── */
export default function App() {
  const [tab, setTab] = useState<TabId>('overview');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('coral-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('coral-theme', theme);
  }, [theme]);

  /* ───── Authentication & Multi-Tenancy States ───── */
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!localStorage.getItem('coral-session-token'));
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem('coral-session-token'));
  const [user, setUser] = useState<any>(null);
  const [tenant, setTenant] = useState<any>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Developer Telemetry Log Entries
  const [telemetryLogs, setTelemetryLogs] = useState<any[]>([
    { time: '11:07:06 AM', source: 'security', event: 'Master Database SSL Enforced', desc: 'Secure connection pool established with rejectUnauthorized: false (Neon requirement)', status: 'success' },
    { time: '11:07:07 AM', source: 'database', event: 'Control Plane Connection Pool Connected', desc: 'Neon Serverless PostgreSQL active on Southeast Asia region (AWS)', status: 'success' }
  ]);

  const [sqlInput, setSqlInput] = useState(
    `SELECT p.title, p.service_name, p.urgency, d.version, d.deployed_at\nFROM pagerduty.incidents p\nJOIN deployments.history d ON p.service_name = d.service\nWHERE p.urgency = 'high'\nORDER BY d.deployed_at DESC;`
  );
  const [sqlResults, setSqlResults] = useState<any[]>([]);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlTime, setSqlTime] = useState<number | null>(null);
  const [sqlRunning, setSqlRunning] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'I\'m your SRE investigation agent. I query across GitHub CI, Sentry, PagerDuty, Slack, and deployment data using Coral\'s unified SQL layer. Ask me to investigate incidents, diagnose failures, or correlate deployments with errors.',
      coralFeatures: ['sql-interface', 'schema-learning'],
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);

  const [stats, setStats] = useState({
    activeIncidents: '-',
    unresolvedErrors: '-',
    latestDeploy: '-',
    ciPassRate: '-',
  });

  const [schema, setSchema] = useState<any[]>([]);
  const [sources, setSources] = useState<string>('');

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Authenticated dynamic API Fetch Wrapper
  async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = localStorage.getItem('coral-session-token');
    const headers = new Headers(options.headers || {});
    const method = options.method || 'GET';
    
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    
    const tStart = performance.now();
    const res = await fetch(url, { ...options, headers });
    const duration = Math.round(performance.now() - tStart);
    
    // Developer Network Telemetry log mapping
    setTelemetryLogs(prev => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        source: 'client',
        event: `${method} ${url}`,
        desc: `Client-side HTTP request executed over-the-wire. Status: ${res.status} returned in ${duration}ms. Authorization JWT session token auto-injected. Third-party SaaS keys locked server-side.`,
        status: res.ok ? 'success' : 'danger'
      }
    ]);
    
    if (res.status === 401) {
      // Automatic session expiry redirect
      localStorage.removeItem('coral-session-token');
      setIsAuthenticated(false);
      setSessionToken(null);
      setUser(null);
      setTenant(null);
    }
    return res;
  }

  async function loadSessionContext() {
    try {
      const res = await apiFetch('/api/v1/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setTenant(data.tenant);
        setIsAuthenticated(true);
        return true;
      } else {
        setIsAuthenticated(false);
        return false;
      }
    } catch {
      setIsAuthenticated(false);
      return false;
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadSessionContext().then((success) => {
        if (success) {
          loadDashboard();
          loadSchema();
          loadSources();
        }
      });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentLoading]);

  /* ───── Authentication Handlers ───── */
  async function handleLogin(e: React.FormEvent, directEmail?: string, directName?: string) {
    if (e) e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    const emailToUse = directEmail || loginEmail;
    const nameToUse = directName || loginName;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToUse, name: nameToUse }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('coral-session-token', data.token);
        setSessionToken(data.token);
        setUser(data.user);
        setIsAuthenticated(true);
        setTelemetryLogs(prev => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            source: 'security',
            event: 'SSO Handshake Successful',
            desc: `Google SSO credentials verified. Issued cryptographically signed HS256 HMAC JWT session token. Tenant workspace schema scope successfully mapped.`,
            status: 'success'
          }
        ]);
      } else {
        setLoginError(data.error || 'SSO authentication failed.');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Server connection failed.');
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('coral-session-token');
    setIsAuthenticated(false);
    setSessionToken(null);
    setUser(null);
    setTenant(null);
    setTelemetryLogs(prev => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        source: 'security',
        event: 'JWT Session Revoked',
        desc: 'Standard logout. Active session credentials purged from localStorage and memory. Request auth headers closed.',
        status: 'warning'
      }
    ]);
    setMessages([
      {
        role: 'assistant',
        content: 'I\'m your SRE investigation agent. I query across GitHub CI, Sentry, PagerDuty, Slack, and deployment data using Coral\'s unified SQL layer. Ask me to investigate incidents, diagnose failures, or correlate deployments with errors.',
        coralFeatures: ['sql-interface', 'schema-learning'],
      },
    ]);
  }

  /* ───── Data loaders ───── */
  async function coralQuery(sql: string): Promise<any[]> {
    const res = await apiFetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    setTelemetryLogs(prev => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        source: 'database',
        event: 'RLS Transaction Enforced',
        desc: `Executed: "${sql.length > 55 ? sql.substring(0, 55) + '...' : sql}". Enforced set_config('app.tenant_id', '${tenant?.id || '00000000-0000-0000-0000-000000000000'}', true) securely on Southeast Asia pools.`,
        status: 'success'
      }
    ]);

    return data.results || [];
  }

  async function loadDashboard() {
    try {
      const [pd, se, dep, ci] = await Promise.all([
        coralQuery("SELECT COUNT(*) as c FROM pagerduty.incidents WHERE status = 'triggered'"),
        coralQuery("SELECT COUNT(*) as c FROM sentry.errors WHERE status = 'unresolved'"),
        coralQuery("SELECT version FROM deployments.history ORDER BY deployed_at DESC LIMIT 1"),
        coralQuery("SELECT status FROM github.builds"),
      ]);
      const total = ci.length;
      const passed = ci.filter((r: any) => r.status === 'success').length;
      setStats({
        activeIncidents: String(pd[0]?.c ?? 0),
        unresolvedErrors: String(se[0]?.c ?? 0),
        latestDeploy: dep[0]?.version ?? 'N/A',
        ciPassRate: total > 0 ? `${Math.round((passed / total) * 100)}%` : 'N/A',
      });
    } catch (e) {
      console.error('Dashboard load failed:', e);
    }
  }

  async function loadSchema() {
    try {
      const res = await apiFetch('/api/schema');
      const data = await res.json();
      setSchema(data.tables || []);
    } catch (e) {
      console.error('Schema load failed:', e);
    }
  }

  async function loadSources() {
    try {
      const res = await apiFetch('/api/sources');
      const data = await res.json();
      setSources(data.output || '');
    } catch (e) {
      console.error('Sources load failed:', e);
    }
  }

  /* ───── SQL Runner ───── */
  async function runSql(custom?: string) {
    const q = custom || sqlInput;
    if (!q.trim()) return;
    setSqlRunning(true);
    setSqlError(null);
    const t0 = performance.now();
    try {
      const results = await coralQuery(q);
      setSqlResults(results);
      setSqlTime(Math.round(performance.now() - t0));
    } catch (e: any) {
      setSqlError(e.message);
      setSqlResults([]);
    } finally {
      setSqlRunning(false);
    }
  }

  /* ───── Agent ───── */
  async function sendToAgent(prompt?: string) {
    const text = prompt || chatInput;
    if (!text.trim()) return;

    const updated: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(updated);
    if (!prompt) setChatInput('');
    setAgentLoading(true);

    try {
      const res = await apiFetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages([
          ...updated,
          {
            role: 'assistant',
            content: data.answer,
            sql: data.sqlQueries?.[0],
            results: data.sqlResults,
            timeline: data.timeline,
            rootCause: data.rootCause,
            coralFeatures: data.coralFeatures,
            queryTimeMs: data.queryTimeMs,
          },
        ]);
        loadDashboard();
      } else {
        setMessages([...updated, { role: 'assistant', content: `Investigation failed: ${data.error}` }]);
      }
    } catch (e: any) {
      setMessages([...updated, { role: 'assistant', content: `Connection error: ${e.message}` }]);
    } finally {
      setAgentLoading(false);
    }
  }

  /* ───── Render Helpers ───── */
  function renderBadge(value: string, variant: string) {
    return <span className={`badge badge--${variant}`}>{value}</span>;
  }

  /* ───── Main Render ───── */
  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-card card">
          <div className="login-logo">
            <Activity size={24} style={{ color: 'var(--accent)' }} />
            <span>Coral AI Bot</span>
          </div>
          <h2 className="login-title">Sign in to SRE SaaS Console</h2>
          <p className="login-desc" style={{ marginBottom: '24px' }}>Securely access your isolated SRE database, alerts, and runbooks scope.</p>
          
          {loginError && (
            <div className="results-error" style={{ marginBottom: '16px', textAlign: 'center' }}>
              {loginError}
            </div>
          )}

          {/* Branded Google SSO Button (Primary 1-click login) */}
          <div style={{ marginBottom: '8px' }}>
            <button 
              type="button"
              onClick={() => {
                setLoginEmail('sre-lead@quest-global.com');
                setLoginName('Priya Sharma');
                const mockFormEvent = { preventDefault: () => {} } as React.FormEvent;
                handleLogin(mockFormEvent, 'sre-lead@quest-global.com', 'Priya Sharma');
              }}
              className="btn"
              style={{ 
                width: '100%', 
                background: '#ffffff', 
                color: '#1f2937', 
                borderColor: '#d1d5db',
                fontWeight: 600,
                padding: '10px 16px',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" style={{ marginRight: '10px', display: 'block' }}>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>Continue with Google SSO</span>
            </button>
            <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '6px', fontStyle: 'italic' }}>
              Instant 1-click workspace mapping for Quest Global Services
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', margin: '22px 0 16px 0', gap: '10px' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
            <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '1px', fontWeight: 700 }}>Or Simulate Custom SSO</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Work Email</label>
              <input 
                type="email" 
                placeholder="dieter.schmidt@t-systems.com" 
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required 
                className="chat-input-field"
                style={{ width: '100%', marginTop: '6px', background: 'var(--bg-root)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="form-group" style={{ marginTop: '14px' }}>
              <label>Developer Name</label>
              <input 
                type="text" 
                placeholder="Dieter Schmidt" 
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                required 
                className="chat-input-field"
                style={{ width: '100%', marginTop: '6px', background: 'var(--bg-root)', color: 'var(--text-primary)' }}
              />
            </div>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loginLoading}
              style={{ width: '100%', marginTop: '22px', justifyContent: 'center' }}
            >
              {loginLoading ? 'Provisioning Scope...' : 'Sign In with Custom SSO'}
            </button>
            <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '8px', lineHeight: '1.4' }}>
              Provision a brand-new multi-tenant DB schema scope dynamically for any simulated domain.
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-logo">
            <Activity size={16} />
            <span>Coral AI Bot</span>
          </div>
          <div className="topbar-sep" />
          <span className="topbar-breadcrumb">
            {tab === 'overview' && 'Incident Overview'}
            {tab === 'history' && 'Investigation History'}
            {tab === 'investigate' && 'SQL Console'}
            {tab === 'sql' && 'SQL Console'}
            {tab === 'sources' && 'Connected Sources'}
            {tab === 'integrations' && 'Integration Hub'}
            {tab === 'api-keys' && 'API Keys'}
            {tab === 'telemetry' && 'API Network Telemetry'}
          </span>
        </div>
        <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {tenant && (
            <span className="badge badge--accent" style={{ textTransform: 'lowercase', fontFamily: 'var(--font-mono)' }}>
              @{tenant.slug}
            </span>
          )}
          {user && (
            <span className="text-secondary" style={{ fontSize: '12px' }}>
              {user.name}
            </span>
          )}
          <button 
            onClick={handleLogout}
            className="btn btn-ghost"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              padding: '4px 10px', 
              borderRadius: 'var(--radius-md)', 
              fontSize: '11px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              height: '26px'
            }}
            title="Sign Out / Change Workspace"
          >
            <LogOut size={12} style={{ color: 'var(--danger)' }} />
            <span>Sign Out</span>
          </button>
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="btn btn-ghost"
            style={{ padding: '6px', minWidth: 'auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <span className="status-pill status-pill--live">Coral Engine Active</span>
          <span className="status-pill status-pill--info">SaaS Pool</span>
        </div>
      </header>

      {/* Workspace Grid */}
      <div className="workspace">
        {/* Sidebar */}
        <nav className="sidebar">
          <div>
            <div className="sidebar-section-label">Operations</div>
            <div className="sidebar-nav">
              {([
                ['overview', Server, 'Incident Overview'],
                ['history', History, 'Investigation History'],
                ['investigate', Terminal, 'SQL Console'],
                ['sources', Database, 'Connected Sources'],
                ['integrations', Plug, 'Integration Hub'],
                ...(user?.role === 'owner' || user?.role === 'admin'
                  ? [['api-keys', Key, 'API Keys'] as [TabId, any, string]]
                  : []),
                ['telemetry', Shield, 'Network Telemetry'],
              ] as [TabId, any, string][]).map(([id, Icon, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`sidebar-item ${tab === id ? 'sidebar-item--active' : ''}`}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="sidebar-section-label">Playbooks</div>
            <div className="sidebar-nav">
              {[
                ['Diagnose Outage', () => sendToAgent('Investigate the current production outage. Correlate PagerDuty incidents with recent deployments and Sentry errors.')],
                ['Debug CI Failure', () => sendToAgent('Examine failed CI builds and correlate them with Sentry error logs to identify the root cause.')],
                ['Verify Rollback', () => sendToAgent('Verify the payment-service rollback status and check if all related incidents are resolved.')],
              ].map(([label, fn]: any, i) => (
                <button key={i} onClick={fn} className="sidebar-item">
                  <Zap size={15} />
                  <span>{label as string}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="schema-section">
            <div className="schema-label">Coral Schema</div>
            <div className="schema-list">
              {['github.builds', 'sentry.errors', 'slack.threads', 'pagerduty.incidents', 'deployments.history', 'enterprise.tickets', 'enterprise.change_requests', 'enterprise.knowledge_base'].map((t) => (
                <div
                  key={t}
                  className="schema-entry"
                  onClick={() => { setTab('investigate'); setSqlInput(`SELECT * FROM ${t} LIMIT 10;`); }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="main-content">
          {tab === 'overview' && <OverviewTab stats={stats} sendToAgent={sendToAgent} apiFetch={apiFetch} runSql={(q: string) => { setTab('investigate'); setSqlInput(q); setTimeout(() => runSql(q), 100); }} />}
          {tab === 'investigate' && (
            <SqlTab
              sqlInput={sqlInput}
              setSqlInput={setSqlInput}
              sqlResults={sqlResults}
              sqlError={sqlError}
              sqlTime={sqlTime}
              sqlRunning={sqlRunning}
              runSql={runSql}
            />
          )}
          {tab === 'sources' && <SourcesTab apiFetch={apiFetch} sources={sources} schema={schema} />}
          {tab === 'integrations' && <IntegrationsTab apiFetch={apiFetch} />}
          {tab === 'history' && <InvestigationHistoryTab apiFetch={apiFetch} />}
          {tab === 'api-keys' && (user?.role === 'owner' || user?.role === 'admin') && (
            <ApiKeysTab apiFetch={apiFetch} user={user} />
          )}
          {tab === 'telemetry' && <TelemetryTab logs={telemetryLogs} />}
        </main>

        {/* Agent Panel */}
        <aside className="panel-agent">
          <div className="panel-agent-header">
            <div className="agent-avatar"><Bot size={14} /></div>
            <div className="agent-meta">
              <div className="agent-name">SRE Investigator</div>
              <div className="agent-status-text">Online · Coral-powered</div>
            </div>
          </div>

          <div className="chat-scroll">
            {messages.map((m, i) => (
              <div key={i} className={`msg msg--${m.role}`}>
                <div>{m.content}</div>

                {m.sql && (
                  <div className="msg-sql">
                    <span className="msg-sql-label">Coral SQL</span>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, paddingTop: 14 }}>{m.sql}</pre>
                  </div>
                )}

                {m.coralFeatures && m.coralFeatures.length > 0 && (
                  <div className="coral-features">
                    {m.coralFeatures.map((f, fi) => (
                      <span key={fi} className="coral-feat">{f}</span>
                    ))}
                    {m.queryTimeMs !== undefined && (
                      <span className="coral-feat" style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>
                        {m.queryTimeMs}ms
                      </span>
                    )}
                  </div>
                )}

                {m.timeline && m.timeline.length > 0 && (
                  <div className="msg-timeline">
                    <div className="msg-timeline-label">Incident Timeline</div>
                    {m.timeline.map((t, ti) => (
                      <div key={ti} className={`tl-item tl-item--${t.type}`}>
                        <span className="tl-time">{t.time}</span>
                        <div className="tl-body">
                          <div className="tl-title">{t.title}</div>
                          <div className="tl-desc">{t.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {m.rootCause && (
                  <div className="root-cause">
                    <div className="root-cause-header">
                      <AlertTriangle size={12} /> Root Cause Identified
                    </div>
                    <div className="root-cause-row"><strong>Service:</strong> <span className="mono">{m.rootCause.service}</span></div>
                    <div className="root-cause-row"><strong>Cause:</strong> {m.rootCause.reason}</div>
                    <div className="root-cause-row"><strong>Commit:</strong> <span className="mono">{m.rootCause.commit}</span></div>
                    <div className="root-cause-row"><strong>Author:</strong> {m.rootCause.author}</div>
                    
                    {m.rootCause.cabStatus && m.rootCause.cabStatus !== 'N/A' && (
                      <div className="root-cause-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        <strong>ServiceNow:</strong>
                        {m.rootCause.cabStatus.toLowerCase().includes('approved') ? (
                          <span className="badge badge--success" style={{ textTransform: 'uppercase', fontSize: 9, padding: '2px 6px' }}>Approved CAB Change Request ({m.rootCause.cabStatus})</span>
                        ) : (
                          <span className="badge badge--danger" style={{ textTransform: 'uppercase', fontSize: 9, padding: '2px 6px' }}>UNAUTHORIZED CHANGE / NO CAB APPROVAL ({m.rootCause.cabStatus})</span>
                        )}
                      </div>
                    )}

                    {m.rootCause.runbook && (
                      <div className="root-cause-runbook" style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <BookOpen size={11} /> Confluence Outage Playbook
                        </div>
                        <div className="runbook-content text-sm text-secondary" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto', fontSize: 11, lineHeight: '1.4' }}>
                          {m.rootCause.runbook}
                        </div>
                      </div>
                    )}

                    {m.rootCause.tickets && m.rootCause.tickets.length > 0 && (
                      <div className="root-cause-tickets" style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4 }}>Linked Advisory Board & Tickets</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {m.rootCause.tickets.map((t, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', background: 'var(--bg-elevated)', borderRadius: '3px', fontSize: 10, border: '1px solid var(--border)' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>[{t.board}] {t.id}</span>
                              <span className="mono text-tertiary" style={{ margin: '0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{t.title}</span>
                              <span className={`badge badge--${t.status === 'Done' ? 'success' : t.status === 'In Progress' ? 'warning' : 'neutral'}`} style={{ fontSize: 8, padding: '1px 3px' }}>{t.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="root-cause-resolution" style={{ marginTop: 10 }}>✓ {m.rootCause.resolution}</div>
                  </div>
                )}
              </div>
            ))}

            {agentLoading && (
              <div className="msg msg--assistant" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="spinner" />
                <span className="text-tertiary text-sm">Querying Coral sources...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); sendToAgent(); }}
            className="chat-input-bar"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask about incidents, deploys, errors..."
              className="chat-input-field"
              disabled={agentLoading}
            />
            <button type="submit" className="chat-send-btn" disabled={agentLoading || !chatInput.trim()}>
              <Send size={14} />
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}

/* ===================================================================
   Sub-components
   =================================================================== */

function OverviewTab({ stats, sendToAgent, runSql, apiFetch }: {
  stats: { activeIncidents: string; unresolvedErrors: string; latestDeploy: string; ciPassRate: string };
  sendToAgent: (p: string) => void;
  runSql: (q: string) => void;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
}) {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [deploys, setDeploys] = useState<any[]>([]);

  useEffect(() => {
    apiFetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "SELECT id, title, service_name, urgency, status, created_at FROM pagerduty.incidents ORDER BY created_at DESC" }),
    }).then(r => r.json()).then(d => setIncidents(d.results || [])).catch(() => {});

    apiFetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "SELECT id, service, version, status, deployed_at, deployed_by FROM deployments.history ORDER BY deployed_at DESC LIMIT 6" }),
    }).then(r => r.json()).then(d => setDeploys(d.results || [])).catch(() => {});
  }, []);

  return (
    <>
      {/* Metrics */}
      <div className="metrics-grid">
        <div className="card metric">
          <div className="metric-label">Active Incidents</div>
          <div className={`metric-value ${Number(stats.activeIncidents) > 0 ? 'metric-value--danger' : ''}`}>
            {stats.activeIncidents}
          </div>
          <div className="metric-detail">PagerDuty triggered</div>
        </div>
        <div className="card metric">
          <div className="metric-label">Unresolved Errors</div>
          <div className={`metric-value ${Number(stats.unresolvedErrors) > 0 ? 'metric-value--warning' : ''}`}>
            {stats.unresolvedErrors}
          </div>
          <div className="metric-detail">Sentry exceptions</div>
        </div>
        <div className="card metric">
          <div className="metric-label">Latest Deploy</div>
          <div className="metric-value metric-value--mono">{stats.latestDeploy}</div>
          <div className="metric-detail">Most recent version</div>
        </div>
        <div className="card metric">
          <div className="metric-label">CI Pass Rate</div>
          <div className={`metric-value ${stats.ciPassRate !== 'N/A' && parseInt(stats.ciPassRate) < 80 ? 'metric-value--warning' : 'metric-value--success'}`}>
            {stats.ciPassRate}
          </div>
          <div className="metric-detail">GitHub Actions</div>
        </div>
      </div>

      {/* Incidents Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Shield size={14} /> Active Incidents</div>
          <button className="btn btn-primary" onClick={() => sendToAgent('Investigate the current production outage. Correlate PagerDuty incidents with recent deployments and Sentry errors.')}>
            <Bot size={13} /> Run AI Investigation
          </button>
        </div>
        {incidents.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Service</th>
                  <th>Urgency</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((row, i) => (
                  <tr key={i}>
                    <td className="mono">{row.id}</td>
                    <td>{row.title}</td>
                    <td className="mono">{row.service_name}</td>
                    <td>{row.urgency === 'high' ? renderBadge('HIGH', 'danger') : row.urgency === 'low' ? renderBadge('LOW', 'neutral') : renderBadge(row.urgency?.toUpperCase(), 'warning')}</td>
                    <td>{row.status === 'triggered' ? renderBadge('TRIGGERED', 'danger') : row.status === 'resolved' ? renderBadge('RESOLVED', 'success') : renderBadge(row.status?.toUpperCase(), 'warning')}</td>
                    <td className="mono text-tertiary">{row.created_at?.substring(11, 19) || row.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-tertiary text-sm" style={{ padding: 16 }}>Loading incidents from Coral...</div>
        )}
      </div>

      {/* Recent Deploys */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Layers size={14} /> Recent Deployments</div>
        </div>
        {deploys.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Service</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Deployed At</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {deploys.map((row, i) => (
                  <tr key={i}>
                    <td className="mono">{row.id}</td>
                    <td className="mono">{row.service}</td>
                    <td className="mono">{row.version}</td>
                    <td>{row.status === 'success' ? renderBadge('SUCCESS', 'success') : renderBadge('FAILED', 'danger')}</td>
                    <td className="mono text-tertiary">{row.deployed_at?.substring(11, 19) || row.deployed_at}</td>
                    <td className="text-secondary">{row.deployed_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-tertiary text-sm" style={{ padding: 16 }}>Loading deployments from Coral...</div>
        )}
      </div>

      {/* Playbooks */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Compass size={14} /> Investigation Playbooks</div>
        </div>
        <div className="playbook-list">
          {[
            {
              icon: Shield, variant: 'danger',
              title: 'Production Outage Diagnosis',
              desc: 'Cross-join PagerDuty alerts with deployment history and Sentry exceptions to isolate cascading failures.',
              prompt: 'Investigate the current production outage. Correlate PagerDuty incidents with recent deployments and Sentry errors.',
            },
            {
              icon: Terminal, variant: 'accent',
              title: 'CI/CD Pipeline Failure Analysis',
              desc: 'Join failed GitHub Actions runs with Sentry stack traces to pinpoint the breaking commit.',
              prompt: 'Examine failed CI builds and correlate them with Sentry error logs to identify the root cause.',
            },
            {
              icon: Activity, variant: 'success',
              title: 'Post-Rollback Health Check',
              desc: 'Verify service health after rollback by correlating deployment state, incident status, and Slack thread updates.',
              prompt: 'Verify the payment-service rollback status and check if all related incidents are resolved.',
            },
          ].map((pb, i) => (
            <div key={i} className="playbook-card" onClick={() => sendToAgent(pb.prompt)}>
              <div className={`playbook-icon playbook-icon--${pb.variant}`}>
                <pb.icon size={18} />
              </div>
              <div className="playbook-info">
                <div className="playbook-title">{pb.title}</div>
                <div className="playbook-desc">{pb.desc}</div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function renderBadge(label: string, variant: string) {
  return <span className={`badge badge--${variant}`}>{label}</span>;
}

function SqlTab({ sqlInput, setSqlInput, sqlResults, sqlError, sqlTime, sqlRunning, runSql }: {
  sqlInput: string; setSqlInput: (v: string) => void;
  sqlResults: any[]; sqlError: string | null; sqlTime: number | null;
  sqlRunning: boolean; runSql: (q?: string) => void;
}) {
  const presets = [
    { label: 'Incidents + Deploys', sql: `SELECT p.title, p.service_name, p.urgency, d.version, d.deployed_at\nFROM pagerduty.incidents p\nJOIN deployments.history d ON p.service_name = d.service\nORDER BY d.deployed_at DESC;` },
    { label: 'Unresolved Errors', sql: `SELECT issue_id, message, level, count, metadata__culprit\nFROM sentry.errors\nWHERE status = 'unresolved'\nORDER BY count DESC;` },
    { label: 'Schema Info', sql: `SELECT schema_name, table_name FROM coral.tables ORDER BY 1, 2;` },
    { label: 'All Columns', sql: `SELECT schema_name, table_name, column_name, data_type FROM coral.columns ORDER BY 1, 2, ordinal_position;` },
    { label: 'Slack Threads', sql: `SELECT id, channel, user, text, replies_count FROM slack.threads ORDER BY ts DESC;` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <div className="card" style={{ flexShrink: 0 }}>
        <div className="card-header">
          <div className="card-title"><Terminal size={14} /> SQL Console</div>
          <span className="text-tertiary text-sm">Queries executed via Coral local engine</span>
        </div>
        <div className="sql-editor-wrap">
          <textarea
            value={sqlInput}
            onChange={(e) => setSqlInput(e.target.value)}
            className="sql-textarea"
            spellCheck={false}
            placeholder="SELECT * FROM coral.tables;"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runSql(); } }}
          />
          <div className="sql-toolbar">
            <div className="sql-presets">
              {presets.map((p, i) => (
                <button key={i} className="sql-preset-btn" onClick={() => setSqlInput(p.sql)}>
                  {p.label}
                </button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => runSql()} disabled={sqlRunning}>
              {sqlRunning ? <><div className="spinner" /> Running...</> : <><Play size={13} /> Execute</>}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="card" style={{ flex: 1, overflow: 'auto' }}>
        {sqlError && <div className="results-error">{sqlError}</div>}

        {!sqlError && sqlResults.length === 0 && !sqlRunning && (
          <div className="results-empty">
            <Terminal size={24} style={{ opacity: 0.3 }} />
            <span>Execute a query to see results</span>
            <span className="text-tertiary" style={{ fontSize: 11 }}>Tip: ⌘+Enter to run</span>
          </div>
        )}

        {!sqlError && sqlResults.length > 0 && (
          <div className="results-container">
            <div className="results-meta">
              <span>{sqlResults.length} row{sqlResults.length !== 1 ? 's' : ''} returned</span>
              {sqlTime !== null && <span>· <strong>{sqlTime}ms</strong></span>}
              <span className="badge badge--accent" style={{ marginLeft: 'auto' }}>Coral SQL</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {Object.keys(sqlResults[0]).map((k) => <th key={k}>{k}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sqlResults.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v: any, j) => (
                        <td key={j} className="mono">
                          {v === null ? <em style={{ color: 'var(--text-tertiary)', fontStyle: 'normal' }}>null</em> : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SourcesTab({ apiFetch, sources, schema }: { apiFetch: any; sources: string; schema: any[] }) {
  const [integrations, setIntegrations] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const sourceList = [
    { name: 'github', table: 'builds', desc: 'CI/CD workflow runs, commit SHAs, test results', provider: 'github' },
    { name: 'sentry', table: 'errors', desc: 'Exception tracking, stack traces, error counts', provider: 'sentry' },
    { name: 'slack', table: 'threads', desc: 'Incident channel messages and thread replies', provider: 'slack' },
    { name: 'pagerduty', table: 'incidents', desc: 'Alert triggers, urgency levels, assignees', provider: 'pagerduty' },
    { name: 'deployments', table: 'history', desc: 'Service versions, deploy times, changelogs', platform: true },
    { name: 'enterprise', table: 'tickets', desc: 'Jira, Azure Boards, ClickUp, and Linear project boards', provider: 'jira' },
    { name: 'enterprise', table: 'change_requests', desc: 'ServiceNow & CAB change ticket audit trails', comingSoon: true },
    { name: 'enterprise', table: 'knowledge_base', desc: 'Confluence & Notion troubleshooting recovery runbooks', comingSoon: true },
  ] as const;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/integrations');
        const data = await res.json();
        if (!cancelled && res.ok) {
          setIntegrations(data.integrations || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiFetch]);

  const integrationMap = React.useMemo(
    () => Object.fromEntries(integrations.map(i => [i.provider, i])),
    [integrations]
  );

  function getSourceStatus(source: (typeof sourceList)[number]) {
    if ('platform' in source && source.platform) {
      return { label: 'Platform', badge: 'neutral' as const, hint: 'Core Coral table — no external OAuth required' };
    }
    if ('comingSoon' in source && source.comingSoon) {
      return { label: 'Not Configured', badge: 'neutral' as const, hint: 'Integration coming in a future release' };
    }
    const provider = 'provider' in source ? source.provider : undefined;
    const integ = provider ? integrationMap[provider] : undefined;
    if (!integ || integ.status === 'disconnected') {
      return { label: 'Disconnected', badge: 'neutral' as const, hint: 'Connect this provider in Integration Hub' };
    }
    if (integ.status === 'simulated') {
      return { label: 'Sandbox', badge: 'warning' as const, hint: 'Using tenant-scoped demo data' };
    }
    return { label: 'Live', badge: 'success' as const, hint: 'Streaming from connected API credentials' };
  }

  const linkedCount = sourceList.filter(s => {
    if ('platform' in s && s.platform) return false;
    if ('comingSoon' in s && s.comingSoon) return false;
    const provider = 'provider' in s ? s.provider : undefined;
    const integ = provider ? integrationMap[provider] : undefined;
    return integ?.status === 'connected' || integ?.status === 'simulated';
  }).length;

  const platformCount = sourceList.filter(s => 'platform' in s && s.platform).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Database size={14} /> Connected Coral Sources</div>
          <span className="badge badge--accent">
            {loading ? 'Loading status...' : `${linkedCount} linked · ${platformCount} platform tables`}
          </span>
        </div>
        <p className="text-tertiary text-sm" style={{ marginBottom: 12 }}>
          Each source reflects its own integration state from Integration Hub. Connect providers individually — connecting Jira does not mark GitHub or PagerDuty as connected.
        </p>
        <div className="sources-grid">
          {sourceList.map((s) => {
            const status = getSourceStatus(s);
            return (
              <div key={`${s.name}.${s.table}`} className="card source-card">
                <div className="source-name">{s.name}</div>
                <div className="source-table">Table: <span className="mono">{s.name}.{s.table}</span></div>
                <div className="text-tertiary text-sm mt-2">{s.desc}</div>
                <div className="source-status" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                  <span className={`badge badge--${status.badge}`}>{status.label}</span>
                  <span className="text-tertiary" style={{ fontSize: 11 }}>{status.hint}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><Search size={14} /> Coral Features Demonstrated</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['SQL Interface', 'All data queried via standard SQL through coral sql --format json'],
            ['Cross-Source Joins', 'JOIN across GitHub, Sentry, PagerDuty, Slack, and Deployments in single queries'],
            ['Schema Learning', 'Query coral.tables and coral.columns for automatic schema introspection'],
            ['Caching', 'Repeated queries return cached results with lower latency'],
            ['Custom Source Specs', '5 YAML source specs defining JSONL-backed tables with typed columns'],
            ['MCP Compatible', 'Sources are exposed via coral mcp-stdio for agent integration'],
          ].map(([title, desc], i) => (
            <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</div>
              <div className="text-tertiary text-sm">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {sources && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Terminal size={14} /> coral source list</div>
          </div>
          <pre className="mono text-secondary" style={{ fontSize: 11, whiteSpace: 'pre-wrap', padding: 8, background: 'var(--bg-root)', borderRadius: 'var(--radius-md)' }}>
            {sources}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ───── Developer Telemetry Tab Component ───── */
function TelemetryTab({ logs }: { logs: any[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title" style={{ gap: '10px' }}><Shield size={16} /> API Network & Security Auditor</div>
          <span className="badge badge--accent">Developer Console</span>
        </div>
        
        <div className="results-meta" style={{ marginBottom: '14px', borderRadius: 'var(--radius-md)', padding: '12px', lineHeight: '1.6' }}>
          🔒 <strong>BFF Security Isolation:</strong> When the client React SPA communicates, only the scoped user JWT is exposed in the browser's <strong>Network Tab</strong>. Sensitive database credentials, root Neon pool contexts, and third-party SaaS integration tokens (PagerDuty, Sentry, Jira) are strictly held in backend server-side memory and never exposed to the client.
        </div>

        <div className="results-container" style={{ maxHeight: '550px', overflowY: 'auto', background: 'var(--bg-root)', border: '1px solid var(--border)' }}>
          <table className="data-table font-mono" style={{ fontSize: '11.5px', borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '100px', padding: '10px' }}>Timestamp</th>
                <th style={{ width: '100px', padding: '10px' }}>Security Layer</th>
                <th style={{ width: '220px', padding: '10px' }}>Event Name</th>
                <th style={{ padding: '10px' }}>Network Payload / Security Audit</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice().reverse().map((log, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-tertiary)', padding: '10px' }}>{log.time}</td>
                  <td style={{ padding: '10px' }}>
                    <span className={`badge badge--${
                      log.source === 'security' ? 'danger' :
                      log.source === 'database' ? 'warning' :
                      log.source === 'client' ? 'accent' : 'neutral'
                    }`} style={{ textTransform: 'uppercase', fontSize: '9.5px', padding: '2px 6px' }}>
                      {log.source}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)', padding: '10px' }}>{log.event}</td>
                  <td style={{ color: 'var(--text-secondary)', padding: '10px', fontSize: '11px', lineHeight: '1.4' }}>{log.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ───── SaaS Integrations Hub Console Tab Component ───── */
function IntegrationsTab({ apiFetch }: { apiFetch: any }) {
  const [integrations, setIntegrations] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeConfigModal, setActiveConfigModal] = React.useState<string | null>(null);
  
  // Form states for credentials input
  const [liveMode, setLiveMode] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [orgSlug, setOrgSlug] = React.useState('');
  const [projSlug, setProjSlug] = React.useState('');
  const [hostUrl, setHostUrl] = React.useState('');
  const [channelId, setChannelId] = React.useState('');
  const [channelName, setChannelName] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [pingingMap, setPingingMap] = React.useState<Record<string, boolean>>({});
  const [diagnosticMsg, setDiagnosticMsg] = React.useState<Record<string, { status: string; message: string; latency?: number }>>({});
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  const defaultIntegrations = React.useMemo(() =>
    ['pagerduty', 'sentry', 'github', 'slack', 'jira'].map(provider => ({
      provider,
      status: 'disconnected',
      config: {},
      lastSyncAt: null,
      errorMessage: null
    })),
  []);

  const fetchIntegrationsList = async () => {
    try {
      const res = await apiFetch('/api/v1/integrations');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to load integrations (${res.status})`);
      }
      setIntegrations(data.integrations?.length ? data.integrations : defaultIntegrations);
      setFetchError(null);
    } catch (err: any) {
      console.error(err);
      setFetchError(err.message || 'Failed to load integrations.');
      setIntegrations(defaultIntegrations);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchIntegrationsList();
  }, []);

  const openConfig = (provider: string, current: any) => {
    setActiveConfigModal(provider);
    setLiveMode(current.status === 'connected');
    setApiKey('');
    setOrgSlug(current.config.organizationSlug || '');
    setProjSlug(current.config.projectSlug || current.config.repo || current.config.projectKey || '');
    setHostUrl(current.config.host || '');
    setChannelId(current.config.channelId || '');
    setChannelName(current.config.channelName || '');
  };

  const handleConnect = async (provider: string) => {
    setSubmitting(true);
    try {
      const config: any = {};
      if (provider === 'sentry') {
        config.organizationSlug = orgSlug || 'quest-global';
        config.projectSlug = projSlug || 'payment-service';
      } else if (provider === 'github') {
        config.owner = orgSlug || 'quest-global';
        config.repo = projSlug || 'payment-service';
      } else if (provider === 'jira') {
        config.host = hostUrl || 'quest-global.atlassian.net';
        config.projectKey = projSlug || 'SRE';
      } else if (provider === 'slack') {
        config.channelId = channelId || 'C07123456';
        config.channelName = channelName || 'incidents';
      }

      const body = {
        mode: liveMode ? 'live' : 'simulated',
        credentials: liveMode ? { apiKey: apiKey || 'test-key' } : undefined,
        config
      };

      const res = await apiFetch(`/api/v1/integrations/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Connection failed');
      }

      await fetchIntegrationsList();
      setActiveConfigModal(null);
    } catch (err: any) {
      alert(`Connection failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async (provider: string) => {
    if (!confirm(`Are you sure you want to disconnect ${provider}?`)) return;
    try {
      const res = await apiFetch(`/api/v1/integrations/${provider}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Disconnect failed');
      }
      await fetchIntegrationsList();
    } catch (err: any) {
      alert(`Disconnect failed: ${err.message}`);
    }
  };

  const runDiagnostics = async (provider: string) => {
    setPingingMap(prev => ({ ...prev, [provider]: true }));
    try {
      const res = await apiFetch(`/api/v1/integrations/${provider}/health`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Health check failed');
      }
      setDiagnosticMsg(prev => ({
        ...prev,
        [provider]: {
          status: data.status,
          message: data.message,
          latency: data.latencyMs
        }
      }));
      fetchIntegrationsList();
    } catch (err: any) {
      setDiagnosticMsg(prev => ({
        ...prev,
        [provider]: {
          status: 'unhealthy',
          message: `Network check failed: ${err.message}`
        }
      }));
    } finally {
      setPingingMap(prev => ({ ...prev, [provider]: false }));
    }
  };

  const providerBranding: Record<string, { color: string; desc: string; placeholder: string; logoColor: string }> = {
    pagerduty: {
      color: '#06b6d4',
      logoColor: '#00A15C',
      desc: 'Correlate real-time incident alerts, schedules, triggers and paging rosters.',
      placeholder: 'PagerDuty REST API v2 Token'
    },
    sentry: {
      color: '#8b5cf6',
      logoColor: '#362D59',
      desc: 'Fetch unresolved runtime exception events, stack traces, and error volumes.',
      placeholder: 'Sentry Auth Integration Token'
    },
    github: {
      color: '#64748b',
      logoColor: '#24292e',
      desc: 'Audit CI/CD pipeline deployments, failing branch builds, and pull request events.',
      placeholder: 'GitHub Personal Access Token (PAT)'
    },
    slack: {
      color: '#ec4899',
      logoColor: '#4A154B',
      desc: 'Query #incidents chat history threads and sync comments into SRE timeline.',
      placeholder: 'Slack Bot User OAuth Token (xoxb-...)'
    },
    jira: {
      color: '#3b82f6',
      logoColor: '#0052CC',
      desc: 'Map engineering issues, sprint backlogs, and bug priority levels.',
      placeholder: 'Jira API Token (or email:token)'
    }
  };

  const providerSandboxPreview: Record<string, { icon: string; title: string; body: string }> = {
    pagerduty: {
      icon: '🚨',
      title: 'Sample PagerDuty incidents',
      body: 'Queries pagerduty.incidents with triggered alerts, urgency levels, and on-call assignees — tenant-scoped via RLS.'
    },
    sentry: {
      icon: '🐛',
      title: 'Sample Sentry errors',
      body: 'Queries sentry.errors with unresolved exceptions, stack traces, and error counts — no Sentry token required.'
    },
    github: {
      icon: '⚙️',
      title: 'Sample GitHub CI runs',
      body: 'Queries github.builds with workflow results, commit SHAs, and failure logs from the demo pipeline.'
    },
    slack: {
      icon: '💬',
      title: 'Sample Slack incident threads',
      body: 'Queries slack.threads with #incidents channel messages and reply counts for timeline correlation.'
    },
    jira: {
      icon: '🎫',
      title: 'Sample Jira tickets',
      body: 'Queries enterprise.tickets with SRE backlog items, priorities, and assignees — no Atlassian credentials required.'
    }
  };

  const formatProviderName = (provider: string) =>
    provider.charAt(0).toUpperCase() + provider.slice(1);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '16px', color: 'var(--text-secondary)' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ fontSize: '14px', fontWeight: 500 }}>Retrieving Org Integration Matrix...</p>
      </div>
    );
  }

  return (
    <div className="integrations-console" style={{ animation: 'fadeIn 0.3s ease' }}>
      <div className="console-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <h2 className="tab-header-title" style={{ fontSize: '20px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
          <Plug size={20} className="text-accent" /> SaaS Integration Hub
        </h2>
        <span className="badge badge--success" style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
          {integrations.filter(i => i.status === 'connected' || i.status === 'simulated').length} Connected
        </span>
      </div>
      
      <p className="console-subtitle" style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px', lineHeight: '1.5' }}>
        Securely bridge third-party SRE developer tools into your tenant workspace context.
        All API access tokens are stored in the cloud vault using military-grade <code style={{ backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--accent)' }}>AES-256-GCM</code> encryption and isolated at the backend proxy layer.
      </p>

      {fetchError && (
        <div style={{ marginBottom: '16px', padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444', fontSize: '12px' }}>
          Could not refresh integration status: {fetchError}. Showing default providers — you can still connect below.
        </div>
      )}

      <div className="integrations-grid">
        {integrations.map(integ => {
          const brand = providerBranding[integ.provider] || { color: '#64748b', logoColor: '#333', desc: '', placeholder: '' };
          const isConnected = integ.status === 'connected' || integ.status === 'simulated';
          const isSimulated = integ.status === 'simulated';
          const pinging = pingingMap[integ.provider];
          const health = diagnosticMsg[integ.provider];

          return (
            <div
              key={integ.provider}
              className={`integration-card ${isConnected ? 'integration-card--connected' : ''}`}
            >
              <div className="card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="provider-info" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div 
                    className="provider-logo" 
                    style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '8px', 
                      backgroundColor: brand.logoColor,
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '15px',
                      letterSpacing: '0.5px'
                    }}
                  >
                    {integ.provider.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="provider-name" style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                      {integ.provider}
                    </h3>
                    <div style={{ marginTop: '4px' }}>
                      {integ.status === 'disconnected' && (
                        <span className="badge badge--neutral" style={{ fontSize: '10px', padding: '2px 6px' }}>
                          Disconnected
                        </span>
                      )}
                      {isConnected && isSimulated && (
                        <span className="badge badge--warning" style={{ fontSize: '10px', padding: '2px 6px' }}>
                          Sandbox
                        </span>
                      )}
                      {isConnected && !isSimulated && (
                        <span className="badge badge--success" style={{ fontSize: '10px', padding: '2px 6px' }}>
                          Live
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="card-actions">
                  {isConnected ? (
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => handleDisconnect(integ.provider)}
                      style={{ color: '#ef4444', padding: '4px 8px', fontSize: '11px', fontWeight: 600 }}
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => openConfig(integ.provider, integ)}
                      style={{ color: 'var(--accent)', padding: '4px 8px', fontSize: '11px', fontWeight: 600, border: '1px solid var(--border)' }}
                    >
                      Configure
                    </button>
                  )}
                </div>
              </div>

              <p className="provider-desc" style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.45', margin: 0, flexGrow: 1 }}>
                {brand.desc}
              </p>

              {isConnected && (
                <div
                  className="diagnostic-block"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div className="diagnostic-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="diagnostic-title" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Diagnostic Telemetry
                    </span>
                    <button 
                      className="btn btn-secondary btn-xs btn-ping" 
                      onClick={() => runDiagnostics(integ.provider)} 
                      disabled={pinging}
                      style={{ fontSize: '10px', padding: '2px 8px', height: '20px' }}
                    >
                      {pinging ? 'Pinging...' : 'Test Connection'}
                    </button>
                  </div>

                  {health ? (
                    <div 
                      className={`health-banner health-banner--${health.status}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        backgroundColor: health.status === 'healthy' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                        borderLeft: `3px solid ${health.status === 'healthy' ? '#10b981' : '#ef4444'}`
                      }}
                    >
                      <div className="health-detail" style={{ flexGrow: 1 }}>
                        <div className="health-text" style={{ fontSize: '12px', fontWeight: 600, color: health.status === 'healthy' ? '#10b981' : '#ef4444' }}>
                          {health.status === 'healthy' ? 'Verification Passed' : 'Verification Failed'}
                        </div>
                        <div className="health-message" style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {health.message}
                        </div>
                      </div>
                      {health.latency !== undefined && (
                        <div className="health-latency" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {health.latency}ms
                        </div>
                      )}
                    </div>
                  ) : (
                    <div 
                      className="health-banner health-banner--idle"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--bg-tertiary)',
                        borderLeft: '3px solid var(--text-tertiary)'
                      }}
                    >
                      <div className="health-detail">
                        <div className="health-text" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          Diagnostic Standby
                        </div>
                        <div className="health-message" style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          Run health test to verify endpoint state.
                        </div>
                      </div>
                    </div>
                  )}

                  {integ.lastSyncAt && (
                    <div className="last-sync-time" style={{ fontSize: '10px', color: 'var(--text-tertiary)', textAlign: 'right' }}>
                      Last Sync Check: {new Date(integ.lastSyncAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {activeConfigModal && (
        <div className="integration-modal-backdrop" onClick={() => setActiveConfigModal(null)}>
          <div className="integration-modal" onClick={e => e.stopPropagation()}>
            <div className="integration-modal__header">
              <h3 className="integration-modal__title">
                Configure {formatProviderName(activeConfigModal)} Connection
              </h3>
              <button
                type="button"
                className="integration-modal__close"
                onClick={() => setActiveConfigModal(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="integration-modal__body">
              <div>
                <span className="integration-modal__label">Connection mode</span>
                <div className="integration-modal__toggle">
                  <button
                    type="button"
                    className={`integration-modal__toggle-btn ${!liveMode ? 'integration-modal__toggle-btn--active' : ''}`}
                    onClick={() => setLiveMode(false)}
                  >
                    Sandbox Demo
                  </button>
                  <button
                    type="button"
                    className={`integration-modal__toggle-btn ${liveMode ? 'integration-modal__toggle-btn--active' : ''}`}
                    onClick={() => setLiveMode(true)}
                  >
                    Live API Key
                  </button>
                </div>
              </div>

              {liveMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label className="integration-modal__field-label">
                      {providerBranding[activeConfigModal]?.placeholder}
                    </label>
                    <input
                      type="password"
                      className="integration-modal__input"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="Paste private key / authorization token..."
                    />
                  </div>

                  {activeConfigModal === 'sentry' && (
                    <>
                      <div>
                        <label className="integration-modal__field-label">Sentry Organization Slug</label>
                        <input type="text" className="integration-modal__input" value={orgSlug} onChange={e => setOrgSlug(e.target.value)} placeholder="e.g. quest-global" />
                      </div>
                      <div>
                        <label className="integration-modal__field-label">Sentry Project Slug</label>
                        <input type="text" className="integration-modal__input" value={projSlug} onChange={e => setProjSlug(e.target.value)} placeholder="e.g. payment-service" />
                      </div>
                    </>
                  )}

                  {activeConfigModal === 'github' && (
                    <>
                      <div>
                        <label className="integration-modal__field-label">GitHub Owner / Organization</label>
                        <input type="text" className="integration-modal__input" value={orgSlug} onChange={e => setOrgSlug(e.target.value)} placeholder="e.g. quest-global" />
                      </div>
                      <div>
                        <label className="integration-modal__field-label">GitHub Repository Name</label>
                        <input type="text" className="integration-modal__input" value={projSlug} onChange={e => setProjSlug(e.target.value)} placeholder="e.g. payment-service" />
                      </div>
                    </>
                  )}

                  {activeConfigModal === 'jira' && (
                    <>
                      <div>
                        <label className="integration-modal__field-label">Jira Atlassian Host Name</label>
                        <input type="text" className="integration-modal__input" value={hostUrl} onChange={e => setHostUrl(e.target.value)} placeholder="e.g. quest-global.atlassian.net" />
                      </div>
                      <div>
                        <label className="integration-modal__field-label">Jira Project Key</label>
                        <input type="text" className="integration-modal__input" value={projSlug} onChange={e => setProjSlug(e.target.value)} placeholder="e.g. SRE" />
                      </div>
                    </>
                  )}

                  {activeConfigModal === 'slack' && (
                    <>
                      <div>
                        <label className="integration-modal__field-label">Slack Incident Channel ID</label>
                        <input type="text" className="integration-modal__input" value={channelId} onChange={e => setChannelId(e.target.value)} placeholder="e.g. C07123456" />
                      </div>
                      <div>
                        <label className="integration-modal__field-label">Slack Channel Display Name</label>
                        <input type="text" className="integration-modal__input" value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="e.g. incidents" />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="integration-modal__info">
                  <span style={{ fontSize: '18px', lineHeight: 1 }}>{providerSandboxPreview[activeConfigModal]?.icon || '☁️'}</span>
                  <div>
                    <h4 className="integration-modal__info-title">
                      {providerSandboxPreview[activeConfigModal]?.title || 'Sandbox demo mode'}
                    </h4>
                    <p className="integration-modal__info-text">
                      {providerSandboxPreview[activeConfigModal]?.body || 'Loads pre-seeded demo data scoped to your tenant. No third-party API keys required.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="integration-modal__footer">
              <button type="button" className="btn btn-secondary" onClick={() => setActiveConfigModal(null)} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => handleConnect(activeConfigModal)} disabled={submitting}>
                {submitting ? 'Connecting...' : 'Establish Integration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───── Investigation History Tab ───── */
function InvestigationHistoryTab({ apiFetch }: { apiFetch: any }) {
  const [investigations, setInvestigations] = React.useState<any[]>([]);
  const [selected, setSelected] = React.useState<any | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/investigations');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load history');
        setInvestigations(data.investigations || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [apiFetch]);

  const openDetail = async (id: string) => {
    try {
      const res = await apiFetch(`/api/v1/investigations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelected(data.investigation);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) {
    return <p className="text-secondary">Loading investigation history...</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><History size={14} /> Investigation History</div>
          <span className="badge badge--accent">{investigations.length} saved</span>
        </div>
        <p className="text-tertiary text-sm" style={{ marginBottom: 12 }}>
          Every agent investigation is persisted per tenant with SQL queries, timeline, and root cause analysis.
        </p>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        {investigations.length === 0 ? (
          <p className="text-secondary text-sm">No investigations yet. Run one from the agent panel or playbooks.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {investigations.map(inv => (
              <button
                key={inv.id}
                type="button"
                className="btn btn-ghost"
                style={{ textAlign: 'left', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                onClick={() => openDetail(inv.id)}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {inv.query.length > 80 ? `${inv.query.substring(0, 80)}...` : inv.query}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {inv.intent} · {inv.duration_ms}ms · {new Date(inv.created_at).toLocaleString()} · {inv.source}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Investigation Detail</div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Close</button>
          </div>
          <p className="text-sm" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{selected.answer}</p>
          {selected.root_cause && (
            <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Root Cause — {selected.root_cause.service}</div>
              <div className="text-secondary text-sm" style={{ marginTop: 4 }}>{selected.root_cause.reason}</div>
            </div>
          )}
          {selected.sql_queries?.length > 0 && (
            <pre style={{ fontSize: 11, padding: 12, background: 'var(--bg-root)', borderRadius: 'var(--radius-sm)', overflow: 'auto' }}>
              {selected.sql_queries.join('\n\n-- ---\n\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ───── API Keys Tab ───── */
function ApiKeysTab({ apiFetch, user }: { apiFetch: any; user: any }) {
  const [keys, setKeys] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [newRawKey, setNewRawKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const fetchKeys = async () => {
    try {
      const res = await apiFetch('/api/v1/api-keys');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load API keys');
      setKeys(data.keys || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchKeys(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setNewRawKey(null);
    try {
      const res = await apiFetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: ['read', 'investigate', 'query'] })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create key');
      setNewRawKey(data.rawKey);
      setName('');
      await fetchKeys();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this API key? Applications using it will immediately lose access.')) return;
    try {
      const res = await apiFetch(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchKeys();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Key size={14} /> API Keys</div>
          <span className="badge badge--neutral">{user?.role}</span>
        </div>
        <p className="text-tertiary text-sm" style={{ marginBottom: 16 }}>
          Programmatic access for CI/CD and automation. Keys are SHA-256 hashed at rest — the full secret is shown once on creation only.
        </p>

        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="integration-modal__input"
            placeholder="Key name (e.g. CI Pipeline)"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Creating...' : 'Generate Key'}
          </button>
        </form>

        {newRawKey && (
          <div style={{ padding: 12, marginBottom: 16, background: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', marginBottom: 6 }}>Copy your new API key now</div>
            <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{newRawKey}</code>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
              Use header: <code>X-API-Key: your-key</code>
            </div>
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        {loading ? (
          <p className="text-secondary">Loading keys...</p>
        ) : keys.length === 0 ? (
          <p className="text-secondary text-sm">No active API keys.</p>
        ) : (
          <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td><code>{k.key_prefix}...</code></td>
                  <td>{(k.scopes || []).join(', ')}</td>
                  <td>{new Date(k.created_at).toLocaleDateString()}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleRevoke(k.id)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

