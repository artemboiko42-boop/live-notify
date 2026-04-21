require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let subscriptions = [];
let lastBattleNotifyAt = 0;
const BATTLE_COOLDOWN_MS = 5 * 60 * 1000;

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

async function sendFirebasePush({ title, body, url }) {
  const accessToken = await getAccessToken();

  const message = {
    message: {
      topic: 'all',
      data: {
        title: title || '🔴 ARTIK в ефірі',
        body: body || 'Натисни, щоб перейти в ефір',
        url: url || process.env.LIVE_URL || '',
      }
    }
  };

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`FCM error: ${text}`);
  }

  return text;
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/config', (req, res) => {
  res.json({ liveUrl: process.env.LIVE_URL || '' });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ ok: false, error: 'Invalid subscription' });
  }
  const exists = subscriptions.some(item => item.endpoint === sub.endpoint);
  if (!exists) subscriptions.push(sub);
  res.status(201).json({ ok: true, count: subscriptions.length });
});

app.post('/unsubscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.json({ ok: true, count: subscriptions.length });
  }
  subscriptions = subscriptions.filter(item => item.endpoint !== sub.endpoint);
  res.json({ ok: true, count: subscriptions.length });
});

app.post('/notify', async (req, res) => {
  const { secret, url, title, body } = req.body || {};

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).send('Forbidden');
  }

  const finalUrl = url || process.env.LIVE_URL;
  const finalTitle = title || '🔴 ARTIK в ефірі';
  const finalBody = body || 'Натисни, щоб перейти в ефір';

  const payload = JSON.stringify({
    title: finalTitle,
    body: finalBody,
    url: finalUrl
  });

  const alive = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      alive.push(sub);
    } catch (err) {
      const code = err && err.statusCode;
      if (code !== 404 && code !== 410) alive.push(sub);
    }
  }
  subscriptions = alive;

  let firebaseOk = true;
  let firebaseResult = null;

  try {
    firebaseResult = await sendFirebasePush({
      title: finalTitle,
      body: finalBody,
      url: finalUrl,
    });
  } catch (err) {
    firebaseOk = false;
    firebaseResult = err.message;
  }

  res.json({
    ok: true,
    webSubscribers: subscriptions.length,
    firebaseOk,
    firebaseResult,
    url: finalUrl
  });
});

app.post('/notify-battle', async (req, res) => {
  const { type } = req.body || {};
  }

  if (type !== 'win' && type !== 'lose') {
    return res.status(400).json({ ok: false, message: 'Invalid type' });
  }

  const now = Date.now();
  const remainingMs = BATTLE_COOLDOWN_MS - (now - lastBattleNotifyAt);

  if (remainingMs > 0) {
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return res.json({
      ok: false,
      cooldown: true,
      message: `Цю дію вже відправили. Спробуй знову приблизно через ${remainingMinutes} хв.`
    });
  }

  lastBattleNotifyAt = now;

  const finalTitle = 'ARTIK LIVE';
  const finalBody =
    type === 'win'
      ? 'Потрібно забрати віни 🔥'
      : 'Втрачаємо віни, заходь зараз ⚡';

  const payload = JSON.stringify({
    title: finalTitle,
    body: finalBody,
    url: process.env.LIVE_URL
  });

  const alive = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      alive.push(sub);
    } catch (err) {
      const code = err && err.statusCode;
      if (code !== 404 && code !== 410) alive.push(sub);
    }
  }
  subscriptions = alive;

  let firebaseOk = true;
  let firebaseResult = null;

  try {
    firebaseResult = await sendFirebasePush({
      title: finalTitle,
      body: finalBody,
      url: process.env.LIVE_URL,
    });
  } catch (err) {
    firebaseOk = false;
    firebaseResult = err.message;
  }

  return res.json({
    ok: true,
    cooldown: false,
    message: 'Сповіщення відправлено всім ✅',
    webSubscribers: subscriptions.length,
    firebaseOk,
    firebaseResult
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
