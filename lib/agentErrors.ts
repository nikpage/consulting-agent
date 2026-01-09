import type { SupabaseClient } from '@supabase/supabase-js';

export interface AgentError {
  error_id: string;
  user_id: string;
  agent_type: string;
  message_user: string;
  message_internal: string;
}

export function generateErrorId(): string {
  const prefix = 'A';
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

export function createUserMessage(error: Error, agentType: string): string {
  const msg = error.message.toLowerCase();

  if (msg.includes('token') || msg.includes('auth') || msg.includes('credential')) {
    return 'Email access expired.';
  }
  if (msg.includes('calendar')) {
    return 'Calendar access issue.';
  }
  if (msg.includes('network') || msg.includes('timeout')) {
    return 'Network connection failed.';
  }
  if (msg.includes('database') || msg.includes('supabase')) {
    return 'Database error occurred.';
  }

  return 'Agent processing failed.';
}

export async function saveAgentError(
  supabase: SupabaseClient,
  userId: string,
  agentType: string,
  error: Error
): Promise<string> {
  const errorId = generateErrorId();
  const messageUser = createUserMessage(error, agentType);
  const messageInternal = `${error.message}\n${error.stack || ''}`;

  await supabase.from('agent_errors').insert({
    error_id: errorId,
    user_id: userId,
    agent_type: agentType,
    message_user: messageUser,
    message_internal: messageInternal
  });

  return errorId;
}
