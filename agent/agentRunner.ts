import { renewIfExpiring } from '../lib/calendar-setup';
import { saveAgentError } from '../lib/agentErrors';
import { createAgentContext } from './agentContext';
import { runIngestion } from './agents/ingestion';

export async function runAgentForClient(clientId: string): Promise<{
  clientId: string;
  processedMessages: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processedMessages = 0;
  let ctx;

  try {
    ctx = await createAgentContext(clientId);

    if (!ctx) {
      errors.push('Failed to create agent context');
      return { clientId, processedMessages: 0, errors };
    }

    // Check pause
    const settings = ctx.client.settings || {};
    if (settings.agent_paused === true) {
      return { clientId, processedMessages: 0, errors: ['Agent paused'] };
    }

    // Renew calendar webhook
    const tokens = typeof ctx.client.google_oauth_tokens === 'string'
      ? JSON.parse(ctx.client.google_oauth_tokens)
      : ctx.client.google_oauth_tokens;

    await renewIfExpiring(ctx.supabase, ctx.client.id, tokens, settings);

    // Run ingestion agent
    processedMessages = await runIngestion(ctx);

  } catch (clientError: any) {
    const errorId = await saveAgentError(ctx?.supabase, clientId, 'ingestion', clientError);
    errors.push(`${clientError.message} Error ID: ${errorId}`);
  }

  return { clientId, processedMessages, errors };
}
