ARCHITECTURE MAP — SINGLE FILE

ENTRY POINTS
------------
cli/agent.ts
pages/api/ingest.ts
(vercel cron → pages/api/morning-brief.js) [legacy]

CORE (NEW, AUTHORITATIVE)
-------------------------
agent/agentRunner.ts
  → agent/agentContext.ts        (env, client, oauth, gmail, calendar)
  → agent/retryPolicy.ts         (shared retries)
  → agent/idempotency.ts         (duplicate guards)
  → agent/agentSteps/ingest.ts
  → agent/agentSteps/classify.ts
  → agent/agentSteps/thread.ts
  → agent/agentSteps/schedule.ts

AGENT STEPS (CALL INTO LEGACY)
------------------------------
agentSteps/ingest.ts     → lib/ingestion.js
agentSteps/classify.ts   → lib/classification.js
agentSteps/thread.ts     → lib/threading.js + lib/embeddings.js
agentSteps/schedule.ts   → lib/scheduling.js
agentRunner.ts           → lib/calendar-setup.js

LEGACY LIBS (STILL USED)
-----------------------
lib/ingestion.js
lib/classification.js
lib/threading.js
lib/scheduling.js
lib/embeddings.js
lib/calendar-setup.js
lib/google-auth.js
lib/supabase.js
lib/security.ts
lib/cp.js

API / WEBHOOKS (THIN / LEGACY)
------------------------------
pages/api/auth/google/callback.js
pages/api/auth/url.js
pages/api/calendar-webhook.js
pages/api/cmd.ts
pages/api/morning-brief.js   (not refactored)

SCRIPTS / OPS (LEGACY)
---------------------
setup-client.js
backfill.js
clean-db.js
verify-db.js
seed-data.js

DOCS
----
docs/consultant-playbook.md

FLOW (ONE CLIENT)
-----------------
CLI or API
 → agentRunner.ts
   → agentContext.ts
   → ingest → classify → thread → schedule
   → Supabase + Gmail + Calendar
