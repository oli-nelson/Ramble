// Build-checkout only: keep the npm, Cargo, and Tauri package versions aligned.
import fs from 'node:fs';

const version = process.argv[2];
if (!/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(version ?? '')) {
  throw new Error('Invalid release version');
}
// Validate every replacement before writing anything.
const updates = new Map();
for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof json.version !== 'string') throw new Error(`Missing version: ${file}`);
  json.version = version;
  if (file === 'package-lock.json') json.packages[''].version = version;
  updates.set(file, `${JSON.stringify(json, null, 2)}\n`);
}
for (const [file, pattern] of [
  ['src-tauri/Cargo.toml', /(\[package\]\r?\n(?:(?!\[)[^\n]*\n)*?version = ")[^"]+(")/],
  ['src-tauri/Cargo.lock', /(\[\[package\]\]\r?\nname = "ramble"\r?\nversion = ")[^"]+(")/],
]) {
  const text = fs.readFileSync(file, 'utf8');
  if (!pattern.test(text)) throw new Error(`Missing Ramble package version: ${file}`);
  updates.set(file, text.replace(pattern, (_, prefix, suffix) => `${prefix}${version}${suffix}`));
}
for (const [file, text] of updates) fs.writeFileSync(file, text);
