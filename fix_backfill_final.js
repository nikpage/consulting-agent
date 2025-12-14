const fs = require('fs');
const fileName = 'backfill.js';

try {
    let content = fs.readFileSync(fileName, 'utf8');

    // 1. Define the Retry Function
    const retryFn = `
// --- RETRY LOGIC START ---
async function retryWithBackoff(fn) {
    let attempts = 0;
    while (attempts < 20) { // High retry count for stubborn rate limits
        try {
            return await fn();
        } catch (error) {
            const msg = error.message || JSON.stringify(error);
            // Check for Rate Limit (429) or Quota Exceeded
            if (msg.includes('429') || msg.includes('Quota') || msg.includes('Too Many Requests')) {
                attempts++;
                // Exponential backoff: 2s, 4s, 8s... up to ~17 mins max
                const delay = Math.pow(1.5, attempts) * 2000; 
                console.warn(\`[RATE LIMIT] Pausing for \${(delay/1000).toFixed(1)}s (Attempt \${attempts})...\`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error("ABORTING: API Quota still exceeded after 20 retries.");
}
// --- RETRY LOGIC END ---
`;

    // 2. Insert Retry Function at the top (after imports)
    if (!content.includes('async function retryWithBackoff')) {
        // Insert before "async function backfill()"
        content = content.replace('async function backfill() {', retryFn + '\n\nasync function backfill() {');
    }

    // 3. Wrap the specific AI-heavy function calls
    // Wrap processMessagePipeline
    content = content.replace(
        /await processMessagePipeline\(([^)]+)\)/g, 
        'await retryWithBackoff(() => processMessagePipeline($1))'
    );

    // Wrap findOrCreateThread
    content = content.replace(
        /await findOrCreateThread\(([^)]+)\)/g, 
        'await retryWithBackoff(() => findOrCreateThread($1))'
    );

    // Wrap updateThreadSummary
    content = content.replace(
        /await updateThreadSummary\(([^)]+)\)/g, 
        'await retryWithBackoff(() => updateThreadSummary($1))'
    );

    fs.writeFileSync(fileName, content);
    console.log("SUCCESS: backfill.js patched with retry logic.");

} catch (err) {
    console.error("PATCH FAILED:", err);
    process.exit(1);
}
