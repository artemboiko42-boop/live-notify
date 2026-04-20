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
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.post('/subscribe', (req, res) => {
  subscriptions.push(req.body);
  res.status(201).json({});
});

app.post('/notify', async (req, res) => {
  const { secret, url } = req.body;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).send('Forbidden');
  }

  const payload = JSON.stringify({
    title: '🔴 Я в ефірі!',
    body: 'Натисни щоб перейти',
    url: url || process.env.LIVE_URL
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (e) {}
  }

  res.send('ok');
});

app.listen(process.env.PORT || 3000);