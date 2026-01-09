import { getAuthUrl } from '../../../../lib/google-auth';

export default function handler(req: any, res: any) {
  const url = getAuthUrl();
  res.redirect(url);
}
