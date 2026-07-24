# ningdan.work

Static homepage + Claude chat API on **Vercel** (no local server required).

## Deploy

1. Push this repo to GitHub and import it in [Vercel](https://vercel.com).
2. In Project → Settings → Environment Variables, set:
   - `ANTHROPIC_API_KEY` = your Anthropic key  
   (Production + Preview)
3. Redeploy.

Chat hits `/api/chat` as a serverless function. Knowledge lives in `knowledge/*.md` (restart/redeploy after edits). Session history is kept in the browser (no SQLite).

## Check

After deploy, open `https://YOUR_DOMAIN/api/health` — you should see `{ "ok": true, "hasKey": true }`.
