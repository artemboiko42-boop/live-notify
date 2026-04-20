
require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let subscriptions = [];

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

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
  const payload = JSON.stringify({
    title: title || '🔴 ARTIK в ефірі',
    body: body || 'Натисни, щоб перейти в ефір',
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

  res.json({ ok: true, subscribers: subscriptions.length, url: finalUrl });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
