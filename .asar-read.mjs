import fs from 'node:fs';
const ASAR = 'D:/Programs/DeepSeek Harness/resources/app.asar';
const buf = fs.readFileSync(ASAR);
let size = buf.readUInt32LE(4);
let jsonStart = 8;
let txt = buf.slice(jsonStart, jsonStart + size).toString('utf8');
let header;
try { header = JSON.parse(txt.replace(/\0+$/, '')); } catch {
  size = buf.readUInt32LE(12); jsonStart = 16;
  header = JSON.parse(buf.slice(jsonStart, jsonStart + size).toString('utf8').replace(/\0+$/, ''));
}
const base = jsonStart + size;
const target = (process.argv[2] || '').replace(/^\/+/, '');
const parts = target.split('/').filter(Boolean);
let node = header;
for (const k of parts) { if (!node || !node.files) { node = null; break; } node = node.files[k]; }
if (!node) { console.error('not found: ' + target); process.exit(1); }
if (node.files) { console.log(Object.keys(node.files).sort().join('\n')); process.exit(0); }
const off = base + Number(node.offset);
process.stdout.write(buf.slice(off, off + node.size).toString('utf8'));
