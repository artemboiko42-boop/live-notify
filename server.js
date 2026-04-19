require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me';
const LIVE_URL = process.env.LIVE_URL || 'https://example.com/live';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'PASTE_YOUR_PUBLIC_KEY';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'PASTE_YOUR_PRIVATE_KEY';
const vapidEmail = process.env.VAPID_SUBJECT || 'mailto:you@example.com';

if (!vapidPublicKey.startsWith('PASTE') && !vapidPrivateKey.startsWith('PASTE')) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'db.sqlite'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    vapidPublicKey,
    liveUrl: LIVE_URL
  });
});

app.post('/api/subscribe', (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription payload' });
  }

  const stmt = `INSERT OR REPLACE INTO subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)`;
  db.run(stmt, [endpoint, keys.p256dh, keys.auth], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to save subscription' });
    }
    res.json({ success: true });
  });
});

app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required' });
  }

  db.run('DELETE FROM subscriptions WHERE endpoint = ?', [endpoint], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to unsubscribe' });
    }
    res.json({ success: true, removed: this.changes });
  });
});

app.get('/api/subscribers', (req, res) => {
  db.get('SELECT COUNT(*) as total FROM subscriptions', (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to count subscribers' });
    }
    res.json({ total: row.total });
  });
});

app.post('/api/go-live', (req, res) => {
  const { secret, title, body, url } = req.body || {};
  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (vapidPublicKey.startsWith('PASTE') || vapidPrivateKey.startsWith('PASTE')) {
    return res.status(500).json({ error: 'Set VAPID keys in .env first' });
  }

  const notificationPayload = JSON.stringify({
    title: title || 'Я в эфире 🔴',
    body: body || 'Подключайся прямо сейчас',
    url: url || LIVE_URL
  });

  db.all('SELECT endpoint, p256dh, auth FROM subscriptions', async (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read subscribers' });
    }

    const results = { sent: 0, failed: 0, removed: 0 };

    await Promise.all(rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth }
      };

      try {
        await webpush.sendNotification(subscription, notificationPayload);
        results.sent += 1;
      } catch (error) {
        results.failed += 1;
        if (error.statusCode === 404 || error.statusCode === 410) {
          db.run('DELETE FROM subscriptions WHERE endpoint = ?', [row.endpoint]);
          results.removed += 1;
        }
      }
    }));

    res.json({ success: true, ...results, total: rows.length });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Live notify app running on http://localhost:${PORT}`);
});
