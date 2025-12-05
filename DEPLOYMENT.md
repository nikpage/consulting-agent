# Deployment Guide

## Step 1: Google Cloud Setup

1. Go to https://console.cloud.google.com
2. Create new project: "Sales Assistant"
3. Enable APIs:
   - Gmail API
   - Google Calendar API
   - Distance Matrix API
4. Create OAuth 2.0 Client:
   - Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URIs: 
     - `http://localhost:3000/api/auth/google/callback` (dev)
     - `https://your-domain.vercel.app/api/auth/google/callback` (prod)
   - Save Client ID and Secret
5. Create API Key:
   - Credentials → Create Credentials → API Key
   - Restrict to Distance Matrix API
   - Save key

## Step 2: Gemini API

1. Go to https://makersuite.google.com/app/apikey
2. Create API key
3. Save key

## Step 3: Supabase RLS

Run the `database-policies.sql` file in Supabase SQL Editor.

## Step 4: Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
cd sales-assistant
vercel
```

## Step 5: Set Environment Variables in Vercel

Go to Vercel dashboard → Project → Settings → Environment Variables

Add all variables from `.env.example`:
- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI (use production URL)
- GOOGLE_MAPS_API_KEY
- GEMINI_API_KEY
- ADMIN_PASSWORD
- NEXTAUTH_URL (production URL)
- NEXTAUTH_SECRET

## Step 6: Verify Cron Jobs

Vercel will automatically set up cron jobs from `vercel.json`:
- Ingestion: Every 10 minutes
- Morning brief: Daily at 6 AM

## Step 7: First Client Setup

1. Go to `https://your-domain.vercel.app/admin/setup`
2. Enter admin password
3. Create first client
4. Click "Connect Google"
5. Complete OAuth flow
6. Configure client settings:
   - Work hours
   - Do-Now block
   - Default location
7. Wait 10 minutes for first ingestion

## Testing

- Test ingestion: `curl -X POST https://your-domain.vercel.app/api/ingest`
- Test morning brief: `curl -X POST https://your-domain.vercel.app/api/morning-brief`

## Troubleshooting

- Check Vercel logs: Dashboard → Deployments → View Function Logs
- Check Supabase logs: Dashboard → Logs
- Verify OAuth redirect URI matches exactly
- Ensure all ENV vars are set correctly
