import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const root = new URL('../frontend/dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', root), 'utf8'));
const entry = Object.keys(manifest).find(key => manifest[key].isEntry);
if (!entry) throw new Error('Missing frontend entry manifest');
const files = new Set();
function visit(key) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return;
  files.add(chunk.file);
  (chunk.imports ?? []).forEach(visit);
}
visit(entry);
let raw = 0, gzip = 0;
for (const file of files) {
  const bytes = await readFile(new URL(file, root)); raw += bytes.length; gzip += gzipSync(bytes).length;
}
console.log(`Initial JavaScript: ${raw} bytes; ${gzip} gzip bytes. Lazy routes/PDF excluded.`);
if (raw > 500000 || gzip > 150000) throw new Error('Initial JavaScript exceeds the 500 kB / 150 kB gzip budget');
