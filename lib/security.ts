import crypto from 'crypto';
const SECRET = process.env.NEXTAUTH_SECRET || 'fallback-secret';

export function signParams(params: Record<string, string>) {
  const str = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', SECRET).update(str).digest('hex');
}

export function verifySignature(query: any) {
  const { sig, ...params } = query;
  if (!sig) return false;
  return sig === signParams(params as Record<string, string>);
}
