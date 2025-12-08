import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function processAdminCommands(text: string) {
  const updates: any = {};
  const bufferMatch = text.match(/Buffer:\s*(\d+)/i);
  if (bufferMatch) updates.travelOverride = parseInt(bufferMatch[1]);

  const saveMatch = text.match(/Save:\s*(\w+)\s+(\w+)\s+(.+)/i);
  if (saveMatch) {
    const [_, name, label, address] = saveMatch;
    const { data: cp } = await supabase.from('cps').select('id, locations').ilike('name', `%${name}%`).single();
    if (cp) await supabase.from('cps').update({ locations: { ...cp.locations, [label.toLowerCase()]: address.trim() } }).eq('id', cp.id);
  }
  return updates;
}
