const { data: existing } = await supabase
  .from('users')
  .select('google_oauth_tokens')
  .eq('id', state)
  .single();

const merged = {
  ...(existing?.google_oauth_tokens || {}),
  ...tokens,
  refresh_token: existing?.google_oauth_tokens?.refresh_token || tokens.refresh_token
};

await supabase.from('users')
  .update({ google_oauth_tokens: merged })
  .eq('id', state);
