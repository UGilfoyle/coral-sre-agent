import { queryControlPlanePostgres } from '../../shared/database.js';
import { signJwt, verifyJwt } from '../auth/auth.service.js';
import { connectIntegration } from '../integration/integration.service.js';

export interface SlackInstallation {
  tenantId: string;
  teamId: string;
  teamName: string;
  botToken: string;
  botUserId: string;
}

const SLACK_OAUTH_SCOPES = [
  'chat:write',
  'commands',
  'app_mentions:read',
  'channels:history',
  'channels:read'
].join(',');

function getAppBaseUrl(): string {
  return process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
}

function getSlackClientConfig() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  return { clientId, clientSecret, signingSecret };
}

export function isSlackBotConfigured(): boolean {
  const { signingSecret } = getSlackClientConfig();
  return Boolean(signingSecret);
}

export function isSlackOAuthConfigured(): boolean {
  const { clientId, clientSecret } = getSlackClientConfig();
  return Boolean(clientId && clientSecret);
}

export function buildSlackOAuthState(tenantId: string): string {
  return signJwt({ tenantId, purpose: 'slack_oauth' }, 600);
}

export function parseSlackOAuthState(state: string): string | null {
  const payload = verifyJwt(state);
  if (!payload || payload.purpose !== 'slack_oauth' || !payload.tenantId) {
    return null;
  }
  return payload.tenantId as string;
}

export function buildSlackOAuthUrl(tenantId: string): string {
  const { clientId } = getSlackClientConfig();
  if (!clientId) {
    throw new Error('SLACK_CLIENT_ID is not configured.');
  }

  const redirectUri = `${getAppBaseUrl()}/api/slack/oauth/callback`;
  const state = buildSlackOAuthState(tenantId);
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_OAUTH_SCOPES,
    redirect_uri: redirectUri,
    state
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function resolveTenantByTeamId(teamId: string): Promise<string | null> {
  const rows = await queryControlPlanePostgres(
    `SELECT tenant_id
     FROM integrations
     WHERE provider = 'slack'
       AND status = 'active'
       AND config->>'teamId' = $1
     LIMIT 1`,
    [teamId]
  );

  return rows[0]?.tenant_id ?? null;
}

export async function getSlackInstallationForTeam(teamId: string): Promise<SlackInstallation | null> {
  const rows = await queryControlPlanePostgres(
    `SELECT tenant_id, access_token_enc, config
     FROM integrations
     WHERE provider = 'slack'
       AND status = 'active'
       AND config->>'teamId' = $1
       AND access_token_enc IS NOT NULL
     LIMIT 1`,
    [teamId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const config =
    typeof row.config === 'string' ? JSON.parse(row.config) : row.config || {};

  const { decryptToken } = await import('../../shared/crypto.js');

  return {
    tenantId: row.tenant_id,
    teamId: config.teamId,
    teamName: config.teamName || 'Slack Workspace',
    botToken: decryptToken(row.access_token_enc),
    botUserId: config.botUserId || ''
  };
}

export async function getSlackBotStatus(tenantId: string): Promise<{
  installed: boolean;
  teamId?: string;
  teamName?: string;
  oauthConfigured: boolean;
}> {
  const rows = await queryControlPlanePostgres(
    `SELECT config FROM integrations WHERE tenant_id = $1 AND provider = 'slack' LIMIT 1`,
    [tenantId]
  );

  if (rows.length === 0) {
    return { installed: false, oauthConfigured: isSlackOAuthConfigured() };
  }

  const config =
    typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config || {};

  return {
    installed: Boolean(config.botInstalled && config.teamId),
    teamId: config.teamId,
    teamName: config.teamName,
    oauthConfigured: isSlackOAuthConfigured()
  };
}

export async function handleSlackOAuthCallback(
  code: string,
  state: string
): Promise<{ tenantId: string; teamName: string }> {
  const tenantId = parseSlackOAuthState(state);
  if (!tenantId) {
    throw new Error('Invalid or expired OAuth state.');
  }

  const { clientId, clientSecret } = getSlackClientConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Slack OAuth is not configured on the server.');
  }

  const redirectUri = `${getAppBaseUrl()}/api/slack/oauth/callback`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Slack OAuth token exchange failed.');
  }

  const botToken = data.access_token as string;
  const teamId = data.team?.id as string;
  const teamName = data.team?.name as string;
  const botUserId = data.bot_user_id as string;

  if (!botToken || !teamId) {
    throw new Error('Slack OAuth response missing bot token or team ID.');
  }

  const existingOwner = await resolveTenantByTeamId(teamId);
  if (existingOwner && existingOwner !== tenantId) {
    throw new Error('This Slack workspace is already linked to another Coral organization.');
  }

  await connectIntegration(
    tenantId,
    'slack',
    'live',
    { token: botToken },
    {
      teamId,
      teamName,
      botUserId,
      botInstalled: true,
      channelId: data.incoming_webhook?.channel_id,
      channelName: data.incoming_webhook?.channel || 'incidents'
    }
  );

  return { tenantId, teamName };
}
