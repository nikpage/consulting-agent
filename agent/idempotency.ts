export async function assertMessageNotProcessed(supabase: any, messageId: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('id', messageId)
    .maybeSingle();
  
  return !existing;
}

export async function assertEventNotProcessed(supabase: any, title: string, clientId: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from('todos')
    .select('id')
    .eq('user_id', clientId)
    .eq('description', title)
    .maybeSingle();
  
  return !existing;
}
