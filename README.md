# Sales Assistant MVP

## Setup

### 1. Database (Already Done)
Your Supabase database is ready with all tables.

### 2. Environment Variables
Copy `.env.example` to `.env.local` and fill in:

```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
GOOGLE_MAPS_API_KEY=your_maps_key
GEMINI_API_KEY=your_gemini_key
ADMIN_PASSWORD=your_admin_password
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=random_secret_string
```

### 3. Google Cloud Setup
1. Go to Google Cloud Console
2. Create new project
3. Enable Gmail API
4. Enable Google Calendar API
5. Enable Distance Matrix API
6. Create OAuth 2.0 credentials
7. Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
8. Get API key for Maps

### 4. Gemini API
1. Go to Google AI Studio
2. Get API key for Gemini

### 5. Install & Run
```bash
npm install
npm run dev
```

### 6. Setup Clients
1. Go to `http://localhost:3000/admin/setup`
2. Enter admin password
3. Create client
4. Connect Google account
5. Configure settings

## Deploy to Vercel
```bash
vercel
```

Set all environment variables in Vercel dashboard.
Cron jobs will run automatically.

## API Endpoints

- `POST /api/ingest` - Run email ingestion
- `POST /api/morning-brief` - Send morning agendas
- `GET /api/admin/clients` - List clients
- `POST /api/admin/clients` - Create client
- `PUT /api/admin/clients/[id]/settings` - Update settings

## Cron Schedule

- Ingestion: Every 10 minutes
- Morning brief: Daily at 6:00 AM

## What's Built

✅ Gmail ingestion with classification
✅ Calendar integration
✅ LLM classification (Gemini)
✅ Event scheduling with travel time
✅ Todo scheduling
✅ Morning agenda email
✅ Admin setup interface
✅ Multi-client support with RLS
✅ OAuth flow

## What's Not Built (Future)

- WhatsApp integration
- PWA interface
- Advanced CP merging UI
- Message review/correction UI

