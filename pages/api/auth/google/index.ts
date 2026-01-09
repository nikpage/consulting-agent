import { getAuthUrl } from '../../../../lib/google-auth';

export default function handler(req: any, res: any) {
  const userId = req.query.user_id;

  const baseUrl = getAuthUrl();
  const url = baseUrl + `&state=${encodeURIComponent(userId)}`;

  res.redirect(url);
}
