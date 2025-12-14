const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

// --- CONFIG ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function runDirectTest() {
  console.log('\n==================================================');
  console.log('       🎯 TARGETED LOCATION TEST 🎯');
  console.log('==================================================');

  // 1. FETCH CLIENT
  const { data: users } = await supabase.from('users').select('*').limit(1);
  if (!users || !users.length) return console.error('❌ FAILURE: No users found.');
  const client = users[0];

  // 2. CONNECT GMAIL
  try {
    const tokens = typeof client.google_oauth_tokens === 'string' 
      ? JSON.parse(client.google_oauth_tokens) 
      : client.google_oauth_tokens;
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // 3. SEARCH FOR THE CHALLENGE EMAIL (Ignore Daily Briefs)
    // We look specifically for the email you sent earlier
    const res = await gmail.users.messages.list({ 
      userId: 'me', 
      q: 'subject:Schůzka OR subject:Challenge', 
      maxResults: 1 
    });

    if (!res.data.messages || !res.data.messages.length) {
        return console.error('❌ FAILURE: Could not find the "Schůzka" or "Challenge" email. Please send it again.');
    }
    
    const msgId = res.data.messages[0].id;
    const msgData = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
    
    // Extract Body
    let body = '';
    const payload = msgData.data.payload;
    if (payload.body.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf8');
    } else if (payload.parts) {
      // Recursive simple find
      const findText = (parts) => {
          for (const part of parts) {
              if (part.mimeType === 'text/plain' && part.body.data) return Buffer.from(part.body.data, 'base64').toString('utf8');
              if (part.parts) {
                  const found = findText(part.parts);
                  if (found) return found;
              }
          }
          return '';
      };
      body = findText(payload.parts);
    }

    const headers = payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value;
    const from = headers.find(h => h.name === 'From')?.value;

    console.log(`\n📧 ANALYZING EMAIL:`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Snippet: "${body.substring(0, 100).replace(/\n/g, ' ')}..."`);

    // 4. RUN AI LOGIC
    console.log(`\n🧠 EXTRACTION IN PROGRESS...`);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    
    const prompt = `
      Role: Senior Executive Assistant.
      Task: Extract Event Location.
      
      Input Email: """${body}"""
      
      CRITICAL INSTRUCTION: 
      - The email mentions "my office" or "my place".
      - You MUST look at the SIGNATURE (bottom of email) to find the address.
      - Output valid JSON only.

      Output JSON: { "title": "string (in Czech)", "location": "string (The physical address found)" }
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(text);

    console.log(`\n==================================================`);
    console.log('       ✅ FINAL VERDICT');
    console.log('==================================================');
    console.log(`Title:      ${data.title}`);
    console.log(`Location:   ${data.location}`);
    console.log('==================================================\n');

  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}`);
  }
}

runDirectTest();
