export function verifyCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return true;
  }

  const authHeader = req.headers.authorization ?? "";
  return authHeader === `Bearer ${secret}`;
}
