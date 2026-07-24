# Conversation sync schedule (GitHub Actions)

Hobby/free Vercel only allows **daily** native crons. This project syncs HeyReach
threads via GitHub Actions every ~5 minutes instead.

## Setup

1. Deploy to Vercel and set env `CRON_SECRET` (long random string).
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - `APP_URL` — production URL, e.g. `https://your-app.vercel.app` (no trailing slash)
   - `CRON_SECRET` — **same** value as Vercel `CRON_SECRET`
3. Push/merge so `.github/workflows/sync-conversations.yml` is on the default branch.
4. Confirm under **Actions → Sync conversations** (runs on schedule + manual "Run workflow").

## Notes

- Secrets are **not** exposed in a public repo if stored as Actions secrets (never commit them).
- GitHub may delay scheduled jobs by a few minutes under load.
- Scheduled workflows only run on the **default branch**.
- Endpoint: `POST /api/cron/sync-conversations` with `Authorization: Bearer <CRON_SECRET>`.

## Manual test

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/cron/sync-conversations"
```
