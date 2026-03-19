/**
 * NullClaw Mission Control — Railway Proxy Server
 *
 * Routes:
 *   POST /api/messages        → Anthropic API (/v1/messages)
 *   POST /api/ironclaw        → IronClaw /v1/chat/completions (fixes CORS)
 *   GET  /health              → Health check
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Allowed origin ───────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// ─── CORS ─────────────────────────────────────────────────────
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'x-api-key',
    'anthropic-version',
    'anthropic-dangerous-direct-browser-access',
    'anthropic-beta',
    'authorization',
    'x-ic-url',
  ],
  exposedHeaders: ['Content-Type'],
  credentials: false,
}));

// Handle preflight
app.options('*', cors());

// ─── Body parser ──────────────────────────────────────────────
app.use(express.json({ limit: '4mb' }));

// ─── Rate limiter ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', limiter);

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'nullclaw-proxy',
    timestamp: new Date().toISOString(),
    origin: ALLOWED_ORIGIN,
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'NullClaw Mission Control Proxy',
    version: '1.1.0',
    endpoints: {
      health: 'GET /health',
      messages: 'POST /api/messages',
      ironclaw: 'POST /api/ironclaw',
    },
  });
});

// ─── Main proxy: /api/messages → Anthropic ────────────────────
app.post('/api/messages', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !apiKey.startsWith('sk-')) {
    return res.status(401).json({
      type: 'error',
      error: {
        type: 'authentication_error',
        message: 'Missing or invalid x-api-key header. Pass your Anthropic API key.',
      },
    });
  }

  if (!req.body || !req.body.model) {
    return res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Request body must include a model field.',
      },
    });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        ...(req.headers['anthropic-beta'] && {
          'anthropic-beta': req.headers['anthropic-beta'],
        }),
      },
      body: JSON.stringify(req.body),
    });

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    res.status(response.status);
    res.setHeader('Content-Type', contentType || 'application/json');
    res.send(rawText);

  } catch (err) {
    console.error('[proxy] Fetch error:', err.message);
    res.status(502).json({
      type: 'error',
      error: {
        type: 'proxy_error',
        message: `Proxy failed to reach Anthropic: ${err.message}`,
      },
    });
  }
});

// ─── IronClaw proxy: /api/ironclaw → IronClaw /v1/chat/completions ──
// Routes IronClaw calls server-side to avoid browser CORS preflight issues
app.post('/api/ironclaw', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const icUrl = req.headers['x-ic-url'];

  if (!authHeader || !icUrl) {
    return res.status(400).json({ error: 'Missing Authorization or x-ic-url header.' });
  }

  try {
    const response = await fetch(icUrl.replace(/\/$/, '') + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(req.body),
    });

    const rawText = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(rawText);
  } catch (err) {
    console.error('[ironclaw-proxy] Fetch error:', err.message);
    res.status(502).json({ error: `IronClaw proxy failed: ${err.message}` });
  }
});

// ─── 404 fallback ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ─── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[nullclaw-proxy] Running on port ${PORT}`);
  console.log(`[nullclaw-proxy] ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}`);
});
