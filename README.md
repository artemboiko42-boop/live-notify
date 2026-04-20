# Live Notify UA Final

## Що це
Сайт для підписки на сповіщення про ефір.

- Головна сторінка `/` — для глядачів
- `/admin` — тільки для тебе

## Що потрібно в Render
Environment Variables:
- PORT=10000
- ADMIN_SECRET=1234
- LIVE_URL=твоя посилання на ефір
- VAPID_SUBJECT=mailto:test@test.com
- VAPID_PUBLIC_KEY=вже вставлений у `.env.example`
- VAPID_PRIVATE_KEY=твій приватний ключ

## Важливо
- На iPhone: Safari → Поділитися → На екран «Додому» → відкрити з іконки
- На Android: відкривати краще в Chrome, не у вбудованому браузері Telegram
