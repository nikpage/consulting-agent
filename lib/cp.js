// Changed from CommonJS to ESM to match ingest.js imports
function getSenderEmail(fromHeader) {
  const match = fromHeader.match(/<(.+?)>/);
  return match ? match[1].toLowerCase() : fromHeader.trim().toLowerCase();
}

function getSenderName(fromHeader) {
  return fromHeader.split('<')[0].trim().replace(/"/g, '') || 'Unknown';
}

export async function resolveCp(supabase, userId, fromHeader) {
  const senderEmail = getSenderEmail(fromHeader);
  const senderName = getSenderName(fromHeader);

  // 1. Try to find existing CP
  const { data: cp, error } = await supabase
    .from('cps')
    .select('id')
    .eq('user_id', userId)
    .eq('primary_identifier', senderEmail)
    .maybeSingle();

  if (error) {
    console.error('Error finding CP:', error);
    throw error;
  }

  if (cp) {
    return cp.id;
  }

  // 2. Create new CP if not found
  const { data: newCp, error: createError } = await supabase
    .from('cps')
    .insert({
      user_id: userId,
      name: senderName,
      primary_identifier: senderEmail,
      created_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (createError) {
    console.error('Error creating CP:', createError);
    throw createError;
  }

  return newCp.id;
}
