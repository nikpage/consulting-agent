const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

async function seed() {
  // Get first user
  const { data: users } = await supabase.from('users').select('id').limit(1);
  if (!users || users.length === 0) return console.log('No users found.');
  const userId = users[0].id;

  // Insert Mock Todo
  await supabase.from('todos').insert({
    user_id: userId,
    description: 'Review Alpha Deployment',
    due_date: new Date().toISOString().split('T')[0],
    status: 'pending'
  });
  console.log('✓ Inserted Test Todo');
}
seed();
