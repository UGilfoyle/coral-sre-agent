import type { AgentResponse } from '../../agent.js';

const SLACK_TEXT_LIMIT = 2900;

function truncate(text: string, max = SLACK_TEXT_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '*');
}

export function parseSlackPrompt(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('investigate ')) {
    return trimmed.slice('investigate '.length).trim();
  }
  return trimmed;
}

export function buildInvestigationBlocks(
  prompt: string,
  response: AgentResponse,
  investigationId?: string
): Record<string, unknown>[] {
  const { rootCause, queryTimeMs, timeline, sqlQueries } = response;
  const answer = stripMarkdown(truncate(response.answer || 'No analysis returned.'));

  const blocks: Record<string, unknown>[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🐚 Coral SRE Investigation', emoji: true }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Query:*\n>${truncate(prompt, 500)}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: answer }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Service:*\n\`${rootCause?.service || 'unknown'}\`` },
        { type: 'mrkdwn', text: `*Duration:*\n${queryTimeMs}ms` },
        { type: 'mrkdwn', text: `*SQL queries:*\n${sqlQueries?.length ?? 0}` },
        {
          type: 'mrkdwn',
          text: `*Timeline events:*\n${timeline?.length ?? 0}`
        }
      ]
    }
  ];

  if (rootCause?.reason) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Root cause*\n${truncate(stripMarkdown(rootCause.reason), 800)}`
      }
    });
  }

  if (rootCause?.resolution) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Resolution*\n${truncate(stripMarkdown(rootCause.resolution), 800)}`
      }
    });
  }

  if (timeline && timeline.length > 0) {
    const timelineText = timeline
      .slice(0, 6)
      .map((event) => `• \`${event.time}\` *${event.title}* — ${truncate(event.desc || '', 120)}`)
      .join('\n');

    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Incident timeline*\n${timelineText}` }
      }
    );
  }

  if (investigationId) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_Investigation saved · ID \`${investigationId.slice(0, 8)}…\`_`
        }
      ]
    });
  }

  return blocks;
}

export function buildErrorBlocks(message: string): Record<string, unknown>[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '⚠️ Coral SRE', emoji: true }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(message) }
    }
  ];
}

export function buildAckBlocks(): Record<string, unknown>[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':mag: *Investigating…* Correlating PagerDuty, Sentry, deployments, and Slack threads.'
      }
    }
  ];
}
