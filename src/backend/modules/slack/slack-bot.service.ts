import { handleSreAgentQuery } from '../../agent.js';
import { checkTenantRateLimit } from '../auth/rate-limit.middleware.js';
import {
  buildAckBlocks,
  buildErrorBlocks,
  buildInvestigationBlocks,
  parseSlackPrompt
} from './slack-blocks.js';
import { getSlackInstallationForTeam, resolveTenantByTeamId } from './slack-install.service.js';

export interface SlackInvestigationResult {
  tenantId: string;
  blocks: Record<string, unknown>[];
  investigationId?: string;
}

export async function runSlackInvestigation(
  teamId: string,
  rawPrompt: string,
  slackUserId?: string
): Promise<SlackInvestigationResult> {
  const tenantId = await resolveTenantByTeamId(teamId);
  if (!tenantId) {
    return {
      tenantId: '',
      blocks: buildErrorBlocks(
        'This Slack workspace is not linked to Coral yet. An admin must click *Add to Slack* in the Integration Hub dashboard.'
      )
    };
  }

  const rate = checkTenantRateLimit(tenantId, 'investigate');
  if (!rate.allowed) {
    return {
      tenantId,
      blocks: buildErrorBlocks(
        `Rate limit exceeded. Try again in ${rate.retryAfterSeconds ?? 60} seconds.`
      )
    };
  }

  const prompt = parseSlackPrompt(rawPrompt);
  if (!prompt) {
    return {
      tenantId,
      blocks: buildErrorBlocks(
        'Please provide an investigation query.\nExample: `/coral investigate payment-service errors after 16:00`'
      )
    };
  }

  try {
    const response = await handleSreAgentQuery(prompt, tenantId, {
      userId: slackUserId,
      source: 'slack'
    });

    return {
      tenantId,
      blocks: buildInvestigationBlocks(prompt, response, response.investigationId),
      investigationId: response.investigationId
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Investigation failed.';
    return {
      tenantId,
      blocks: buildErrorBlocks(message)
    };
  }
}

export function getAckBlocks() {
  return buildAckBlocks();
}

export async function verifySlackTeamLinked(teamId: string): Promise<boolean> {
  const installation = await getSlackInstallationForTeam(teamId);
  return Boolean(installation);
}
