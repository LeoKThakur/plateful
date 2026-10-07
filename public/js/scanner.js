// Barcode scanning with zxing-cpp compiled to WebAssembly (vendor/zxing-wasm). The older
// JavaScript ZXing port couldn't read iPhone camera frames reliably.

const FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE'];
const READ_OPTS = { formats: FORMATS, tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1 };

let ready = null;
function loadReader() {
  return (ready ??= new Promise((resolve, reject) => {
    if (window.ZXingWASM) return resolve();
    const s = document.createElement('script');
    s.src = 'vendor/zxing-wasm/reader.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the scanner'));
    document.head.appendChild(s);
  }).then(() => window.ZXingWASM.prepareZXingModule({
    // Load the .wasm from this site (cached for offline) instead of a CDN.
    overrides: { locateFile: (path) => new URL(`vendor/zxing-wasm/${path}`, document.baseURI).href },
    fireImmediately: true,
  })));
}

// Start loading early so the first scan doesn't wait on the download.
export function warmUpScanner() {
  loadReader().catch(() => { ready = null; });
}

async function read(input) {
  const results = await window.ZXingWASM.readBarcodes(input, READ_OPTS);
  const hit = results.find((r) => r.isValid && r.text);
  return hit ? hit.text : null;
}

// Starts the rear camera in `video` and calls onCode(digits) once. Returns stop().
export async function startScanner(video, onCode) {
  let stopped = false;
  let stream;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  };

  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const [, s] = await Promise.all([
    loadReader(),
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, ...size } }),
  ]);
  stream = s;
  if (stopped) { stop(); return stop; }

  // Phones with several rear cameras may hand us an ultra-wide or telephoto lens that can't
  // focus up close. Switch to the main one when we can tell which it is.
  const main = await mainRearCamera(stream.getVideoTracks()[0]);
  if (main) {
    stream.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: main }, ...size } });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, ...size } });
    }
    if (stopped) { stop(); return stop; }
  }

  // Ask for continuous autofocus where the camera supports it; close-up barcodes need it.
  const track = stream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch {}
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let frame = 0;
  const tick = async () => {
    if (stopped) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h) {
      // Alternate between the middle band (where the on-screen box is) and the whole frame.
      const band = frame++ % 2 === 0;
      const sx = band ? w * 0.05 : 0;
      const sy = band ? h * 0.25 : 0;
      const sw = band ? w * 0.9 : w;
      const sh = band ? h * 0.5 : h;
      const scale = Math.min(1, 1280 / sw);
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      try {
        const code = await read(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (code && !stopped) {
          stop();
          navigator.vibrate?.(40);
          onCode(code);
          return;
        }
      } catch {}
    }
    setTimeout(tick, 80);
  };
  tick();

  // Flashlight, where the phone allows web apps to use it (most Android phones do; iPhone doesn't).
  const caps = track.getCapabilities?.() || {};
  if (caps.torch) {
    stop.torch = async (on) => {
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch { return false; }
    };
  }
  return stop;
}

async function mainRearCamera(current) {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.label);
    const rear = cams.filter((d) => /back|rear|environment/i.test(d.label));
    if (rear.length < 2) return null;
    const odd = /ultra|wide|tele|depth|macro|infrared/i;
    // Android names cameras "camera2 0, facing back"; the lowest-numbered rear one is the main lens.
    const android = rear.filter((d) => /camera2 (\d+)/.test(d.label)).sort((a, b) => +a.label.match(/camera2 (\d+)/)[1] - +b.label.match(/camera2 (\d+)/)[1]);
    const pick = android[0] || rear.find((d) => !odd.test(d.label));
    const now = current.getSettings().deviceId;
    return pick && pick.deviceId !== now && (odd.test(current.label) || android.length) ? pick.deviceId : null;
  } catch {
    return null;
  }
}

// Reads a barcode from a photo (the "Take a photo" fallback). Returns the digits or null.
export async function readBarcodeFromFile(file) {
  await loadReader();
  return read(file);
}
