# NullClaw Proxy — Railway Backend

A lightweight Express server that proxies requests from the NullClaw Mission Control frontend to the Anthropic API, solving CORS restrictions in static sites.

## What it does

- Receives `POST /api/messages` from the browser
- Forwards the request to `https://api.anthropic.com/v1/messages`
- Returns Anthropic's response back to the browser
- Never stores API keys — they pass through per-request only

## Deploy to Railway

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial nullclaw proxy"
git remote add origin https://github.com/YOUR_USERNAME/nullclaw-proxy.git
git push -u origin main
```

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project → Deploy from GitHub repo**
3. Select your `nullclaw-proxy` repo
4. Railway auto-detects Node.js and deploys

### Step 3 — Set environment variables

In Railway → your project → **Variables**, add:

| Variable | Value | Required |
|---|---|---|
| `ALLOWED_ORIGIN` | `https://your-nullclaw-site.com` | Recommended |
| `PORT` | (leave blank — Railway sets this automatically) | Auto |

> Set `ALLOWED_ORIGIN` to your exact frontend URL to lock down CORS.  
> During testing you can leave it unset (allows all origins).

### Step 4 — Copy your Railway URL

Once deployed, Railway gives you a URL like:
```
https://nullclaw-proxy-production.up.railway.app
```

Paste that URL into the **Proxy URL** field in the NullClaw frontend Settings.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — returns `{"status":"ok"}` |
| `GET` | `/` | Service info |
| `POST` | `/api/messages` | Proxies to Anthropic `/v1/messages` |

## Local development

```bash
npm install
npm run dev
# Server runs at http://localhost:3000
```

Test it:
```bash
curl http://localhost:3000/health
```
