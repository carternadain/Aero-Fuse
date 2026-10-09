"use client";

// Web push for price alerts. Works in desktop/Android browsers, and on iPhone
// only once the app is added to the Home Screen (iOS 16.4+).

import { api } from "./api";

export type PushSupport = "ok" | "ios-install" | "unsupported";

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function standalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (isIOS() && !standalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** "on" = this device is subscribed; "denied" = the user blocked notifications. */
export async function pushState(): Promise<"on" | "off" | "denied"> {
  if (pushSupport() !== "ok") return "off";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(): Promise<"on" | "denied" | "error"> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  try {
    const reg = (await registerSW()) ?? (await navigator.serviceWorker.ready);
    await navigator.serviceWorker.ready;
    const { key } = await api.get<{ key: string }>("/api/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key) as BufferSource,
      });
    }
    await api.post("/api/push/subscribe", sub.toJSON());
    return "on";
  } catch {
    return "error";
  }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.post("/api/push/unsubscribe", sub.toJSON()).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}
