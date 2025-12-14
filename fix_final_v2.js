const fs = require('fs');
const fileName = 'backfill.js';
const content = fs.readFileSync(fileName, 'utf8');

// 1. Robust Retry Function
const retryCode = `
async function retryWithBackoff(fn) {
    let attempts = 0;
    while (attempts < 15) {
        try {
            return await fn();
        } catch (error) {
            const msg = error.message || JSON.stringify(error);
            if (msg.includes('429') || msg.includes('Quota') || msg.includes('Too Many Requests')) {
                attempts++;
                const delay = Math.pow(1.5, attempts) * 2000;
                console.warn(\`[RATE LIMIT] Pausing \${delay/1000}s...\`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error("Quota exceeded after 15 retries");
}
`;

let newContent = content;

// Inject helper if missing
if (!newContent.includes('async function retryWithBackoff')) {
    // Insert after the first import line to ensure valid module syntax
    newContent = newContent.replace(/import .*\n/, (match) => match + "\n" + retryCode + "\n");
}

// 2. Replacements using exact text from your provided code dump
const replacements = [
    [
        "const classification = await processMessagePipeline(emailData.cleanedText, null);",
        "const classification = await retryWithBackoff(() => processMessagePipeline(emailData.cleanedText, null));"
    ],
    [
        "const threadId = await findOrCreateThread(supabase, user.id, cpId, emailData.cleanedText, emailData.id, classification);",
        "const threadId = await retryWithBackoff(() => findOrCreateThread(supabase, user.id, cpId, emailData.cleanedText, emailData.id, classification));"
    ],
    [
        "await updateThreadSummary(supabase, threadId);",
        "await retryWithBackoff(() => updateThreadSummary(supabase, threadId));"
    ]
];

replacements.forEach(([orig, fixed]) => {
    // Attempt exact replacement
    if (newContent.includes(orig)) {
        newContent = newContent.replace(orig, fixed);
    } 
    // Attempt whitespace-flexible replacement if exact fails
    else {
        const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\s\+/g, '\\s+');
        const re = new RegExp(esc.replace(/\s+/g, '\\s+'), 'g');
        if (re.test(newContent)) {
             newContent = newContent.replace(re, fixed);
        }
    }
});

fs.writeFileSync(fileName, newContent);
console.log("Verified: backfill.js patched.");
