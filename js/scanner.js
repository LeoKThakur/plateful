// Barcode scanning with the rear camera. Uses the native BarcodeDetector when the
// browser has one, otherwise ZXing (iOS Safari has no BarcodeDetector).

let zxingLoaded = null;
function loadZxing() {
  return (zxingLoaded ??= new Promise((resolve, reject) => {
    if (window.ZXing) return resolve();
    const s = document.createElement('script');
    s.src = 'vendor/zxing.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the scanner'));
    document.head.appendChild(s);
  }));
}

// Starts scanning into `video`; calls onCode(digits) once. Returns a stop() function.
export async function startScanner(video, onCode) {
  let stopped = false;
  let stopFns = [];
  const stop = () => {
    stopped = true;
    stopFns.forEach((f) => { try { f(); } catch {} });
    stopFns = [];
  };
  const done = (code) => {
    if (stopped) return;
    stop();
    navigator.vibrate?.(40);
    onCode(code);
  };

  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  if ('BarcodeDetector' in window) {
    const supported = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
    if (formats.some((f) => supported.includes(f))) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      stopFns.push(() => stream.getTracks().forEach((t) => t.stop()));
      video.srcObject = stream;
      await video.play();
      const det = new window.BarcodeDetector({ formats: formats.filter((f) => supported.includes(f)) });
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await det.detect(video);
          if (codes[0]) return done(codes[0].rawValue);
        } catch {}
        setTimeout(tick, 150);
      };
      tick();
      return stop;
    }
  }

  await loadZxing();
  const Z = window.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.BrowserMultiFormatReader(hints, 200);
  stopFns.push(() => reader.reset());
  await reader.decodeFromConstraints(
    { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    video,
    (result) => { if (result) done(result.getText()); },
  );
  if (stopped) reader.reset();
  return stop;
}
