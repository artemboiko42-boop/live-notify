require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let lastBattleNotifyAt = 0;
const BATTLE_COOLDOWN_MS = 5 * 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function getAllSubscriptions() {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, subscription');

  if (error) throw error;
  return data || [];
}

async function saveSubscription(sub) {
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        endpoint: sub.endpoint,
        subscription: sub
      },
      { onConflict: 'endpoint' }
    );

  if (error) throw error;
}

async function deleteSubscription(endpoint) {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);

  if (error) throw error;
}

async function sendWebPushToAll(payload) {
  const rows = await getAllSubscriptions();
  let sent = 0;

  for (const row of rows) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent += 1;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        await deleteSubscription(row.endpoint);
      }
    }
  }

  return sent;
}

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

app.post('/subscribe', async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint) {
      return res.status(400).json({ ok: false, error: 'Invalid subscription' });
    }

    await saveSubscription(sub);
    const all = await getAllSubscriptions();

    res.status(201).json({ ok: true, count: all.length });
  } catch (err) {
    console.error('subscribe error', err);
    res.status(500).json({ ok: false, error: 'Failed to save subscription' });
  }
});

app.post('/unsubscribe', async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint) {
      const all = await getAllSubscriptions();
      return res.json({ ok: true, count: all.length });
    }

    await deleteSubscription(sub.endpoint);
    const all = await getAllSubscriptions();

    res.json({ ok: true, count: all.length });
  } catch (err) {
    console.error('unsubscribe error', err);
    res.status(500).json({ ok: false, error: 'Failed to remove subscription' });
  }
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

  let webSubscribers = 0;
  try {
    webSubscribers = await sendWebPushToAll(payload);
  } catch (err) {
    console.error('web push notify error', err);
    webSubscribers = 0;
  }

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
    webSubscribers,
    firebaseOk,
    firebaseResult,
    url: finalUrl
  });
});

app.post('/notify-battle', async (req, res) => {
  const { type } = req.body || {};

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

  let webSubscribers = 0;
  try {
    webSubscribers = await sendWebPushToAll(payload);
  } catch (err) {
    console.error('web push battle error', err);
    webSubscribers = 0;
  }

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
    webSubscribers,
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
