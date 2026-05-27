import { App, ExpressReceiver } from '@slack/bolt';
import type { Router } from 'express';
import {
  getSlackInstallationForTeam,
  isSlackBotConfigured
} from './slack-install.service.js';
import { getAckBlocks, runSlackInvestigation } from './slack-bot.service.js';
import { parseSlackPrompt } from './slack-blocks.js';

export function createSlackBoltRouter(): Router | null {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.log('ℹ️  Slack bot disabled — set SLACK_SIGNING_SECRET to enable Phase 4 bot.');
    return null;
  }

  const receiver = new ExpressReceiver({
    signingSecret,
    endpoints: '/api/slack/events',
    processBeforeResponse: true
  });

  const slackApp = new App({
    receiver,
    authorize: async ({ teamId }) => {
      if (!teamId) {
        throw new Error('Missing Slack team ID.');
      }

      const installation = await getSlackInstallationForTeam(teamId);
      if (!installation) {
        throw new Error(`Slack workspace ${teamId} is not linked to Coral.`);
      }

      return {
        botToken: installation.botToken,
        botUserId: installation.botUserId,
        teamId: installation.teamId
      };
    }
  });

  slackApp.command('/coral', async ({ command, ack, respond }) => {
    await ack();

    const prompt = parseSlackPrompt(command.text || '');

    await respond({
      response_type: 'in_channel',
      blocks: getAckBlocks() as any
    });

    const result = await runSlackInvestigation(command.team_id, prompt, command.user_id);

    await respond({
      response_type: 'in_channel',
      replace_original: true,
      blocks: result.blocks as any
    });
  });

  slackApp.event('app_mention', async ({ event, client, say }) => {
    if (event.subtype) return;

    const rawText = 'text' in event ? event.text || '' : '';
    const prompt = rawText.replace(/<@[^>]+>/g, '').trim();

    await say({
      blocks: getAckBlocks() as any,
      thread_ts: event.ts
    });

    const result = await runSlackInvestigation(event.team || '', prompt, event.user);

    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      blocks: result.blocks as any
    });
  });

  slackApp.error(async (error) => {
    console.error('[Slack Bolt]', error);
  });

  console.log('✓ Slack Bolt app ready at /api/slack/events');
  return receiver.router;
}

export function slackBotEnabled(): boolean {
  return isSlackBotConfigured();
}
