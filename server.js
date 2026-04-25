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

// 🔥 DONATE MEMORY (можно потом в базу)
let donateQueue = [];     // ожидание
let donateApproved = [];  // подтвержденные

// 🔥 SUMMING
function addOrUpdateDonation(name, amount) {
  const existing = donateApproved.find(d => d.name === name);

  if (existing) {
    existing.amount += amount;
  } else {
    donateApproved.push({ name, amount });
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ================= PUSH =================

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
      sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        await deleteSubscription(row.endpoint);
      }
    }
  }

  return sent;
}

// ================= FIREBASE =================

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
        title,
        body,
        url
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

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.text();
}

// ================= DONATE API =================

// пользователь отправил "я задонатив"
app.post('/donate', (req, res) => {
  const { name, amount, show } = req.body;

  if (!name || !amount) {
    return res.status(400).json({ ok: false });
  }

  donateQueue.push({
    id: Date.now(),
    name,
    amount: Number(amount),
    show: show !== false
  });

  res.json({ ok: true });
});

// получить подтвержденные
app.get('/donations', (req, res) => {
  res.json(donateApproved);
});

// админ — список ожидания
app.get('/admin/donations', (req, res) => {
  res.json(donateQueue);
});

// подтвердить донат
app.post('/admin/approve', (req, res) => {
  const { id } = req.body;

  const index = donateQueue.findIndex(d => d.id === id);
  if (index === -1) return res.json({ ok: false });

  const item = donateQueue[index];

  if (item.show) {
    addOrUpdateDonation(item.name, item.amount);
  }

  donateQueue.splice(index, 1);

  res.json({ ok: true });
});

// удалить
app.post('/admin/delete', (req, res) => {
  const { id } = req.body;

  donateQueue = donateQueue.filter(d => d.id !== id);

  res.json({ ok: true });
});

// ================= ROUTES =================

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/config', (req, res) => {
  res.json({ liveUrl: process.env.LIVE_URL || '' });
});

app.post('/subscribe', async (req, res) => {
  try {
    await saveSubscription(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

app.post('/unsubscribe', async (req, res) => {
  try {
    await deleteSubscription(req.body.endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// ================= SERVER =================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
