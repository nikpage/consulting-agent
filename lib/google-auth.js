import { google } from 'googleapis'

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

export function getAuthUrl(state) {
  const oauth2Client = getOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    state,
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar'
    ]
  })
}

export async function getTokensFromCode(code) {
  const oauth2Client = getOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

export function setCredentials(tokens) {
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials(tokens)
  return oauth2Client
}

export async function getAuthenticatedClient(supabase, userId, tokens) {
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials(tokens)

  const now = Date.now()
  const expiryDate = tokens.expiry_date || 0
  const isExpired = expiryDate < now + 5 * 60 * 1000

  if (isExpired && tokens.refresh_token) {
    const { credentials } = await oauth2Client.refreshAccessToken()
    oauth2Client.setCredentials(credentials)
    await supabase.from('users').update({ google_oauth_tokens: credentials }).eq('id', userId)
  }

  return oauth2Client
}
