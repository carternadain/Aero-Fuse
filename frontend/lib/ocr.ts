// Free, in-browser OCR for card screenshots. tesseract.js is loaded on demand so it stays
// out of the page bundle; its worker, core and English data are self-hosted in /tesseract
// (copied by scripts/copy-tesseract.mjs).

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 4000;

export const isImageFile = (f: File) =>
  f.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name);

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("This browser can't open that image. Try a PNG or JPG screenshot.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw to a canvas, upscale small images, grayscale, make text dark-on-light, stretch contrast. */
export async function prepareImage(file: File): Promise<HTMLCanvasElement> {
  const src = await decode(file);
  const w0 = src.width, h0 = src.height;
  let scale = w0 < 1200 ? 2 : 1;
  scale = Math.min(scale, MAX_SIDE / Math.max(w0, h0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w0 * scale));
  canvas.height = Math.max(1, Math.round(h0 * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't read images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if ("close" in src) src.close();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const n = canvas.width * canvas.height;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const g = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    gray[i] = g;
    hist[gray[i]]++;
  }
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  const invert = sum / n < 128; // dark mode: flip so text is dark on a light page

  // Clip the darkest/brightest 1% and stretch what is left to the full range.
  const pct = (frac: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * frac) return v; }
    return 255;
  };
  const lo = pct(0.01), hi = Math.max(pct(0.99), lo + 1);
  const k = 255 / (hi - lo);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let v = Math.min(255, Math.max(0, (gray[i] - lo) * k));
    if (invert) v = 255 - v;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** OCR each image in order; returns the text joined by a blank line. progress is 0-1 overall. */
export async function recognizeImages(files: File[], onProgress: (p: number) => void): Promise<string> {
  for (const f of files) {
    if (f.size > MAX_IMAGE_BYTES) throw new Error(`${f.name || "That image"} is too big (15 MB max).`);
  }
  onProgress(0);
  const { createWorker } = await import("tesseract.js");
  let current = 0;
  const worker = await createWorker("eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract",
    langPath: "/tesseract",
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress((current + m.progress) / files.length);
    },
  });
  try {
    const texts: string[] = [];
    for (; current < files.length; current++) {
      const canvas = await prepareImage(files[current]);
      const { data } = await worker.recognize(canvas);
      texts.push(data.text.trim());
    }
    onProgress(1);
    return texts.filter(Boolean).join("\n\n");
  } finally {
    await worker.terminate();
  }
}
