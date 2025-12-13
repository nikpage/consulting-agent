import { google } from 'googleapis'

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

export function getAuthUrl() {
  const oauth2Client = getOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
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

  // Check if token is expired or about to expire (5 min buffer)
  const now = Date.now()
  const expiryDate = tokens.expiry_date || 0
  const isExpired = expiryDate < now + 5 * 60 * 1000

  if (isExpired && tokens.refresh_token) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken()
      oauth2Client.setCredentials(credentials)

      // Save new tokens to DB
      await supabase
        .from('users')
        .update({ google_oauth_tokens: credentials })
        .eq('id', userId)

      console.log('[AUTH] Tokens refreshed for user', userId)
    } catch (err) {
      console.error('[AUTH] Token refresh failed:', err.message)
      throw err
    }
  }

  return oauth2Client
}
