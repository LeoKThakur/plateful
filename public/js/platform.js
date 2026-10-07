// Which phone we're on, whether the app is installed, and Android/desktop install prompts.

const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// Chrome (Android and desktop) offers its own install dialog; keep the event so a button can open it.
let deferred = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((f) => f());
});

export const canPromptInstall = () => !!deferred;
export const onInstallChange = (f) => listeners.add(f);

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((f) => f());
  return outcome;
}

export function cameraHelp() {
  if (isIOS) return 'Camera access is off. Allow it in Settings › Safari › Camera (or Settings › Plateful), or type the number below.';
  if (isAndroid) return 'Camera access is off. Tap the icon left of the address bar (or long-press the Plateful app icon › App info › Permissions) and allow Camera, or type the number below.';
  return 'Camera access is off. Allow it in your browser\'s site settings, or type the number below.';
}
