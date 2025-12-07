const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

async function wipe() {
  console.log('--- 🧨 COMPLETE WIPE (Keeping Users Only) ---');

  const tables = [
    'todos',
    'events', 
    'cp_states',
    'message_embeddings',
    'messages',
    'thread_participants',
    'conversation_threads',
    'channels',
    'cps'
  ];

  for (const table of tables) {
    console.log(`... Deleting ${table}`);
    await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  }

  console.log('--- ✅ ALL DATA CLEARED (Users preserved) ---');
}

wipe();
