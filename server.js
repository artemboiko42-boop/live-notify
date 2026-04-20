require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
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

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  const exists = subscriptions.some(s => JSON.stringify(s) === JSON.stringify(sub));
  if (!exists) subscriptions.push(sub);
  res.status(201).json({ ok: true });
});

app.post('/notify', async (req, res) => {
  const { secret, url } = req.body || {};

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).send('Forbidden');
  }

  const finalUrl = url || process.env.LIVE_URL;

  const payload = JSON.stringify({
    title: '🔴 Я в ефірі',
    body: 'Натисни, щоб перейти в ефір',
    url: finalUrl
  });

  const alive = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      alive.push(sub);
    } catch (err) {
      const code = err && err.statusCode;
      if (code !== 404 && code !== 410) {
        alive.push(sub);
      }
    }
  }

  subscriptions = alive;
  res.json({ ok: true, sent: subscriptions.length, url: finalUrl });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Live notify app running on http://localhost:${process.env.PORT || 3000}`);
});
