// Copies tesseract.js assets into public/tesseract so OCR runs without third-party CDNs.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const out = join(root, "public", "tesseract");
mkdirSync(out, { recursive: true });

// createWorker defaults to LSTM-only, so only the *-lstm core builds are needed.
const core = ["tesseract-core-lstm", "tesseract-core-simd-lstm", "tesseract-core-relaxedsimd-lstm"]
  .map((n) => `${n}.wasm.js`);
const files = [
  [join(nm, "tesseract.js/dist/worker.min.js"), "worker.min.js"],
  ...core.map((f) => [join(nm, "tesseract.js-core", f), f]),
  [join(nm, "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), "eng.traineddata.gz"],
];

for (const [src, name] of files) {
  if (!existsSync(src)) {
    console.error(`copy-tesseract: missing ${src}. Run npm install.`);
    process.exit(1);
  }
  copyFileSync(src, join(out, name));
  console.log(`copy-tesseract: ${name} (${(statSync(src).size / 1048576).toFixed(1)} MB)`);
}
