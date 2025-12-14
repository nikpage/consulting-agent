const { JSDOM } = require('jsdom');
const { Buffer } = require('buffer');

function gmailIdToUuid(gmailId) {
  const padded = gmailId.padStart(32, '0');
  return `${padded.slice(0,8)}-${padded.slice(8,12)}-${padded.slice(12,16)}-${padded.slice(16,20)}-${padded.slice(20)}`;
}

function decodeBase64(data) {
  if (!data) return '';
  return Buffer.from(data, 'base64').toString('utf8');
}

function extractEmailBody(payload) {
  if (!payload) return '';
  
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        return decodeBase64(part.body.data);
      }
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        const html = decodeBase64(part.body.data);
        const dom = new JSDOM(html);
        return dom.window.document.body.textContent || '';
      }
      if (part.parts) {
        const nested = extractEmailBody(part);
        if (nested) return nested;
      }
    }
  } 
  
  if (payload.body && payload.body.data) {
    return decodeBase64(payload.body.data);
  }
  
  return '';
}

function cleanText(text) {
  if (!text) return '';
  let cleaned = text;
  cleaned = cleaned.split(/^On .* wrote:$/m)[0];
  cleaned = cleaned.split(/^Begin forwarded message:$/m)[0];
  cleaned = cleaned.split(/^---$/m)[0];
  cleaned = cleaned.split(/^--\s*$/m)[0];
  return cleaned.trim();
}

async function getEmailDetails(gmail, messageId) {
  const res = await gmail.users.messages.get({ 
    userId: 'me', 
    id: messageId,
    format: 'full' 
  });
  
  const headers = res.data.payload.headers;
  const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
  const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
  
  const internalDate = parseInt(res.data.internalDate);
  const timestamp = !isNaN(internalDate) ? new Date(internalDate).toISOString() : new Date().toISOString();

  const rawText = extractEmailBody(res.data.payload);
  const cleanedText = cleanText(rawText);

  return { 
    id: gmailIdToUuid(res.data.id),
    originalId: res.data.id,
    threadId: res.data.threadId,
    from, 
    subject, 
    timestamp, 
    rawText, 
    cleanedText
  };
}

async function storeMessage(supabase, userId, cpId, emailData) {
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('id', emailData.id)
    .maybeSingle();

  if (existing) {
    console.log('Message already exists. Skipping.');
    return;
  }

  const { error } = await supabase
    .from('messages')
    .insert({
      id: emailData.id, 
      user_id: userId,
      cp_id: cpId,
      direction: 'inbound',
      raw_text: emailData.rawText,
      cleaned_text: emailData.cleanedText,
      timestamp: emailData.timestamp
    });

  if (error) {
    console.error('Failed to insert message ' + emailData.originalId + ':', error);
    throw error;
  }
}

module.exports = {
  getEmailDetails,
  storeMessage
};
