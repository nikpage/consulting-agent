# Consultant Playbook

## Initial Setup

### Required Environment Variables
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
SUPABASE_KEY=your-anon-key (fallback)
GEMINI_API_KEY=your-gemini-key
NEXTAUTH_SECRET=your-secret (required, no fallback)
GOOGLE_CLIENT_ID=your-oauth-client-id
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_REDIRECT_URI=your-redirect-uri
```

### Database Tables Required
- `users` - client records with google_oauth_tokens, settings
- `messages` - ingested emails
- `cps` - contact persons
- `conversation_threads` - grouped conversations
- `thread_participants` - thread membership
- `todos` - action items
- `events` - calendar events

### Google OAuth Setup
- Enable Gmail API and Google Calendar API
- Configure OAuth consent screen
- Add scopes: `gmail.readonly`, `gmail.modify`, `calendar.events`
- Store tokens in `users.google_oauth_tokens` (JSON)

---

## CLI Commands

### Run Agent for Single Client
```bash
tsx cli/agent.ts run --client <client-id>
```
Output: `✓ Client <id>: N messages processed` or errors

### Run Agent for All Active Clients
```bash
tsx cli/agent.ts run --all
```
Skips paused clients automatically.

### Pause Agent for Client
```bash
tsx cli/agent.ts pause --client <client-id>
```
Sets `settings.agent_paused = true` in database.

### Check Client Health
```bash
tsx cli/agent.ts health --client <client-id>
```
Shows: email, token status, pause state, calendar webhook expiry.

---

## API Usage

### Trigger Agent via HTTP
```bash
POST /api/ingest
Content-Type: application/json

{
  "clientId": "uuid-here"
}
```
Returns: `{ clientId, processedMessages, errors }`

---

## Common Failures & Fixes

### "Client not found" / "Failed to create agent context"
**Cause**: Missing client record or no OAuth tokens  
**Fix**: Verify client exists in `users` table, check `google_oauth_tokens` is not null

### "Token parse failed"
**Cause**: Malformed JSON in `google_oauth_tokens`  
**Fix**: Re-authenticate client via OAuth flow, store fresh tokens

### Agent runs but processes 0 messages
**Cause**: Client is paused OR no unread emails  
**Fix**: Check `settings.agent_paused`, run health command, verify Gmail has unread messages

### "quota exceeded" / "rate limit" errors
**Cause**: API rate limits (Gmail, Gemini, Calendar)  
**Fix**: Wait for reset (automatic retry with exponential backoff), reduce frequency

### "NEXTAUTH_SECRET is required but not set"
**Cause**: Missing environment variable  
**Fix**: Set `NEXTAUTH_SECRET` in `.env` file, restart application

### Duplicate todos created
**Cause**: Re-running agent on same messages  
**Fix**: Idempotency guards prevent this - safe to re-run. If duplicates appear, check database constraints.

### Calendar webhook expired
**Cause**: Webhook expires after ~1 week  
**Fix**: Agent auto-renews on each run. Manual renewal: re-run agent or call setup function.

---

## Safe Restart Procedure

### Stop Agent
1. If running as cron/scheduled task: disable schedule
2. If running manually: let current execution finish (do not kill mid-process)
3. Verify no active processes: `ps aux | grep agent`

### Verify State
```bash
tsx cli/agent.ts health --client <client-id>
```
Check for any clients with stale webhook expiry or missing tokens.

### Resume Processing
```bash
tsx cli/agent.ts run --all
```
Safe to re-run - idempotency guards prevent duplicate processing.

### Monitor First Run
- Watch for errors in output
- Check `processedMessages` count matches expected unread emails
- Verify no "Failed to create context" errors

---

## Emergency Procedures

### Pause All Clients Immediately
Run pause command for each active client, or update database directly:
```sql
UPDATE users SET settings = jsonb_set(settings, '{agent_paused}', 'true');
```

### Clear Stale Data
If messages are stuck in processing:
```sql
DELETE FROM messages WHERE created_at < NOW() - INTERVAL '7 days' AND thread_id IS NULL;
```

### Force Token Refresh
Delete `google_oauth_tokens` for client, trigger re-authentication via OAuth flow.

---

## Quick Reference

| Task | Command |
|------|---------|
| Process one client | `tsx cli/agent.ts run --client <id>` |
| Process all clients | `tsx cli/agent.ts run --all` |
| Pause client | `tsx cli/agent.ts pause --client <id>` |
| Check health | `tsx cli/agent.ts health --client <id>` |
| Trigger via API | `POST /api/ingest {"clientId":"<id>"}` |
