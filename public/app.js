let swRegistration;
let config;
let deferredPrompt = null;

const $ = (id) => document.getElementById(id);

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function isIos() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function setStatus(id, text) {
  $(id).textContent = text;
}

function updateDeviceUI() {
  if (isIos()) {
    $('deviceText').textContent = 'Обнаружен iPhone / iPad';
    $('iosInstallCard').classList.remove('hidden');
  } else if (isAndroid()) {
    $('deviceText').textContent = 'Обнаружен Android';
    $('androidInstallCard').classList.remove('hidden');
  } else {
    $('deviceText').textContent = 'Обнаружен компьютер или другое устройство';
  }
}

function updateCompatibilityUI() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  $('compatDot').classList.toggle('ok', supported);
  $('compatText').textContent = supported ? 'Уведомления поддерживаются' : 'На этом устройстве push недоступен';
}

async function loadConfig() {
  const res = await fetch('/api/config');
  config = await res.json();
  $('url').value = config.liveUrl || '';
  $('currentUrl').textContent = config.liveUrl || 'не задана';
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker не поддерживается');
  swRegistration = await navigator.serviceWorker.register('/sw.js');
}

async function updateSubscriptionState() {
  if (!swRegistration) return;
  const sub = await swRegistration.pushManager.getSubscription();
  if (sub) {
    setStatus('userStatus', 'Готово: уведомления уже включены на этом устройстве.');
  } else if (isIos() && !isStandalone()) {
    setStatus('userStatus', 'На iPhone сначала добавь сайт на экран «Домой», потом открой его оттуда.');
  }
}

async function enableNotifications() {
  try {
    if (isIos() && !isStandalone()) {
      throw new Error('На iPhone открой сайт с экрана «Домой», затем включи уведомления');
    }

    if (!config?.vapidPublicKey || config.vapidPublicKey.startsWith('PASTE')) {
      throw new Error('На сервере ещё не заданы VAPID-ключи');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Разрешение на уведомления не выдано');
    }

    const existing = await swRegistration.pushManager.getSubscription();
    const subscription = existing || await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
    });

    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось оформить подписку');
    setStatus('userStatus', 'Готово: теперь тебе будут приходить уведомления о прямом эфире.');
  } catch (error) {
    setStatus('userStatus', `Ошибка: ${error.message}`);
  }
}

async function unsubscribeUser() {
  try {
    const subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      setStatus('userStatus', 'Подписки уже нет на этом устройстве.');
      return;
    }

    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });

    await subscription.unsubscribe();
    setStatus('userStatus', 'Уведомления отключены.');
  } catch (error) {
    setStatus('userStatus', `Ошибка: ${error.message}`);
  }
}

async function goLive() {
  try {
    const payload = {
      secret: $('secret').value,
      title: $('title').value,
      body: $('body').value,
      url: $('url').value
    };

    const res = await fetch('/api/go-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось отправить уведомления');
    setStatus('adminStatus', `Отправлено: ${data.sent}/${data.total}. Ошибок: ${data.failed}. Удалено неактивных: ${data.removed}.`);
  } catch (error) {
    setStatus('adminStatus', `Ошибка: ${error.message}`);
  }
}

async function countSubscribers() {
  const res = await fetch('/api/subscribers');
  const data = await res.json();
  setStatus('adminStatus', `Подписчиков: ${data.total}`);
}

function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installBtn').classList.remove('hidden');
  });

  $('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('installBtn').classList.add('hidden');
  });
}

window.addEventListener('load', async () => {
  updateDeviceUI();
  updateCompatibilityUI();
  bindInstallPrompt();

  try {
    await loadConfig();
    await registerServiceWorker();
    await updateSubscriptionState();
  } catch (error) {
    setStatus('userStatus', `Ошибка запуска: ${error.message}`);
  }

  $('enableBtn').addEventListener('click', enableNotifications);
  $('unsubscribeBtn').addEventListener('click', unsubscribeUser);
  $('goLiveBtn').addEventListener('click', goLive);
  $('countBtn').addEventListener('click', countSubscribers);
});
