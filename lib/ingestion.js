import { JSDOM } from 'jsdom';
import { Buffer } from 'buffer';

// --- Configuration ---
const EMAIL_PIN = process.env.EMAIL_PIN || '';

// --- Helpers ---

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

function stripForwardHeaders(text) {
  if (!text) return '';
  let cleaned = text;
  cleaned = cleaned.split(/^On .* wrote:$/m)[0];
  cleaned = cleaned.split(/^Begin forwarded message:$/m)[0];
  cleaned = cleaned.split(/^-----Original Message-----/m)[0];
  cleaned = cleaned.split(/^----- Původní zpráva -----/m)[0];
  cleaned = cleaned.split(/^---$/m)[0];
  return cleaned.trim();
}

// --- New Logic: Forward & Command Parsing ---

function parseForwardedEmail(rawText) {
  const forwardRegex = /----------\s*(?:Forwarded message|Původní zpráva|Original Message)\s*----------/i;
  const match = rawText.match(forwardRegex);

  if (!match) {
    return { isForward: false, userCommands: '', originalBody: rawText, originalFrom: null };
  }

  const splitIndex = match.index;
  const topPart = rawText.substring(0, splitIndex).trim();
  const bottomPart = rawText.substring(splitIndex + match[0].length).trim();

  const fromRegex = /(?:From|Od):\s*(.*?)[\r\n]/i;
  const fromMatch = bottomPart.match(fromRegex);
  let originalFrom = null;

  if (fromMatch && fromMatch[1]) {
    originalFrom = fromMatch[1].trim();
  }

  return {
    isForward: true,
    userCommands: topPart,
    originalBody: bottomPart,
    originalFrom: originalFrom
  };
}

function validatePin(commandText) {
  if (!EMAIL_PIN) return true;
  const pinRegex = /pin\s*[=:]\s*(\S+)/i;
  const match = commandText.match(pinRegex);
  if (!match) return false;
  return match[1] === EMAIL_PIN;
}

// --- Main Functions ---

export async function getEmailDetails(gmail, messageId) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full'
  });

  const headers = res.data.payload.headers;
  let from = headers.find(h => h.name === 'From')?.value || 'Unknown';
  const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';

  const internalDate = parseInt(res.data.internalDate);
  const timestamp = !isNaN(internalDate) ? new Date(internalDate).toISOString() : new Date().toISOString();

  const rawText = extractEmailBody(res.data.payload);

  const { isForward, userCommands, originalBody, originalFrom } = parseForwardedEmail(rawText);
  let finalCleanedText = stripForwardHeaders(rawText);

  if (isForward) {
    if (!validatePin(userCommands)) {
      console.error('[SECURITY] Invalid or missing PIN in forwarded command.');
      throw new Error('Unauthorized: Invalid PIN');
    }

    if (originalFrom) {
      console.log(`[INGEST] Forward detected. Spoofing sender: ${originalFrom}`);
      from = originalFrom;
    }

    const cleanBody = stripForwardHeaders(originalBody);
    const commandsWithoutPin = userCommands.replace(/pin\s*[=:]\s*\S+/ig, '').trim();
    finalCleanedText = `[User Context/Commands]:\n${commandsWithoutPin}\n\n[Original Message]:\n${cleanBody}`;
  }

  return {
    id: gmailIdToUuid(res.data.id),
    originalId: res.data.id,
    threadId: res.data.threadId,
    from,
    subject,
    timestamp,
    rawText,
    cleanedText: finalCleanedText
  };
}

export async function storeMessage(supabase, userId, cpId, emailData) {
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
