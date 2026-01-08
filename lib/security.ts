import crypto from 'crypto';

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET is required but not set');
}

const SECRET = process.env.NEXTAUTH_SECRET;

export function signParams(params: Record<string, string>) {
  const str = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', SECRET).update(str).digest('hex');
}

export function verifySignature(query: any) {
  const { sig, ...params } = query;
  if (!sig) return false;
  return sig === signParams(params as Record<string, string>);
}
