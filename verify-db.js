const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

async function check() {
  console.log('--- 🧠 Checking Agent Brain ---');

  // 1. Check Messages
  const { data: msgs, error: msgError } = await supabase
    .from('messages')
    .select('subject, tag_primary, tag_secondary')
    .order('timestamp', { ascending: false })
    .limit(3);

  if (msgs && msgs.length) {
    console.log('\n📩 RECENT EMAILS:');
    msgs.forEach(m => console.log(`   - ${m.subject} [${m.tag_primary}/${m.tag_secondary}]`));
  } else { console.log('\n📩 No messages found (Check RLS/Permissions if this persists).'); }

  // 2. Check Events (The Test Target)
  const { data: events } = await supabase
    .from('events')
    .select('title, location, status, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  if (events && events.length) {
    console.log(`\n📅 LAST EVENT:\n   Title: ${events[0].title}\n   Location: ${events[0].location}\n   Status: ${events[0].status}`);
  } else { console.log('\n📅 No new events.'); }
  
  // 3. Check Todos
  const { data: todos } = await supabase
    .from('todos')
    .select('description')
    .order('created_at', { ascending: false })
    .limit(1);

  if (todos && todos.length) console.log(`\n✅ LAST TODO:\n   ${todos[0].description}`);
}

check();
