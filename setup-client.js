//setup-client.js
const readline = require('readline');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n=== Add New Client ===\n');

  const name = await question('Client name: ');
  const email = await question('Client email: ');

  const clientId = randomUUID();

  // Save client to database
  const { error } = await supabase
    .from('users')
    .insert({
      id: clientId,
      email: email,
      settings: { name: name }
    });

  if (error) {
    console.error('\nError creating client:', error.message);
    rl.close();
    return;
  }

  console.log('\n✓ Client created in database');

  // Generate OAuth URL (FORCES refresh_token)
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    state: clientId
  });

  console.log('\n=== Authorization Required ===');
  console.log('\nOpen this URL in your browser:');
  console.log('\n' + authUrl + '\n');
  console.log('After authorization, tokens will be saved automatically.\n');

  rl.close();
}

main();
