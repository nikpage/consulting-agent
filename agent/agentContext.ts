//agent/agentContext.ts
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { setCredentials } from '../lib/google-auth';

export interface AgentContext {
  clientId: string;
  client: any;
  supabase: any;
  gmail: any;
  calendar: any;
  apiKey: string;
}

export async function createAgentContext(clientId: string): Promise<AgentContext | null> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY!
  );

  const apiKey = process.env.GEMINI_API_KEY!;

  // Load client
  const { data: client, error: clientError } = await supabase
    .from('users')
    .select('*')
    .eq('id', clientId)
    .single();

  if (clientError || !client) {
    return null;
  }

  if (!client.google_oauth_tokens) {
    return null;
  }

  // Parse tokens
  let tokens;
  try {
    tokens = typeof client.google_oauth_tokens === 'string'
      ? JSON.parse(client.google_oauth_tokens)
      : client.google_oauth_tokens;
  } catch (parseError) {
    return null;
  }

  // Check token expiry and refresh if needed
  const oauth2Client = setCredentials(tokens);
  if (Date.now() >= tokens.expiry_date - 300000) {
    if (!tokens.refresh_token) {
      throw new Error('AUTH_REQUIRED');
    }
    const { credentials } = await oauth2Client.refreshAccessToken();
    tokens.access_token = credentials.access_token;
    tokens.expiry_date = credentials.expiry_date;
    await supabase
      .from('users')
      .update({ google_oauth_tokens: tokens })
      .eq('id', clientId);
  }

  // Setup Gmail and Calendar
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  return {
    clientId,
    client,
    supabase,
    gmail,
    calendar,
    apiKey
  };
}
