import { signParams } from '../../lib/security';

export function generateConflictEmail(cpName: string, summary: string, originalTime: Date, alternatives: { id: string, start: Date }[], groupId: string) {
  const baseUrl = process.env.NEXTAUTH_URL;
  const makeLink = (p: any) => `${baseUrl}/api/cmd?${new URLSearchParams({...p, sig: signParams(p)})}`;
  const format = (d: Date) => d.toLocaleString('cs-CZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  let html = `<h3>⚠️ Conflict with ${cpName}</h3><p>${summary}</p><ul>`;
  
  html += `<li><a href="${makeLink({ scope: 'conflict', action: 'force', group_id: groupId })}">Accept Original (Manual Fix)</a></li>`;
  
  alternatives.forEach((alt, i) => {
    html += `<li><a href="${makeLink({ scope: 'conflict', action: 'accept_option', id: alt.id, group_id: groupId })}">Option ${i+1}: ${format(alt.start)}</a></li>`;
  });
  
  html += `<li><a href="${makeLink({ scope: 'conflict', action: 'reject_all', group_id: groupId })}">❌ Reject All</a></li></ul>`;
  return html;
}
