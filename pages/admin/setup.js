import { google } from "googleapis";
import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:3000/admin/setup"
  );

  const { tokens } = await oauth2Client.getToken(code);

  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  fs.writeFileSync(
    path.join(dir, "google_tokens.json"),
    JSON.stringify(tokens, null, 2)
  );

  res.send("Authorization complete. You can close this tab.");
}
