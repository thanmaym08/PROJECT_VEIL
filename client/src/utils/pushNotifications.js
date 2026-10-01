// Client-side Web Push subscription helper for Project VEIL
import { base64ToBytes } from '../crypto/utils';

export function isPushNotificationSupported() {
  return typeof window !== 'undefined' && 
         'serviceWorker' in navigator && 
         'PushManager' in window &&
         'Notification' in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerServiceWorker() {
  if (!isPushNotificationSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.warn('[PUSH] Service Worker registration failed:', err);
    return null;
  }
}

export async function subscribeToPushNotifications(myId, serverApiBase) {
  if (!isPushNotificationSupported()) {
    throw new Error('Push notifications not supported in this browser.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission denied by user.');
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    throw new Error('Failed to activate service worker.');
  }

  // Fetch VAPID Public Key from Relay Server
  const apiBase = serverApiBase || (typeof window !== 'undefined' ? window.location.origin : '');
  const vapidRes = await fetch(`${apiBase}/api/push/vapid-key`);
  if (!vapidRes.ok) {
    throw new Error('Relay server did not provide VAPID key.');
  }
  const { publicKey } = await vapidRes.json();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
  }

  // Register subscription on relay server linked with myId
  const subRes = await fetch(`${apiBase}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityId: myId,
      subscription: subscription.toJSON()
    })
  });

  if (!subRes.ok) {
    throw new Error('Failed to register subscription with relay server.');
  }

  localStorage.setItem('veil_push_enabled', 'true');
  return subscription;
}

export async function unsubscribeFromPushNotifications(myId, serverApiBase) {
  if (!isPushNotificationSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
    const apiBase = serverApiBase || (typeof window !== 'undefined' ? window.location.origin : '');
    if (myId) {
      await fetch(`${apiBase}/api/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId: myId })
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[PUSH] Unsubscribe error:', err);
  } finally {
    localStorage.removeItem('veil_push_enabled');
  }
}
