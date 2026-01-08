import { getEmailDetails } from '../../lib/ingestion';
import { AgentContext } from '../agentContext';
import { retry } from '../retryPolicy';

export async function ingestEmail(ctx: AgentContext, msgStub: any): Promise<any | null> {
  const emailData = await retry(() => getEmailDetails(ctx.gmail, msgStub.id));

  const { data: existing } = await ctx.supabase
    .from('messages')
    .select('id')
    .eq('id', emailData.id)
    .maybeSingle();

  if (existing) return null;

  return emailData;
}
