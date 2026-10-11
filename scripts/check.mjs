import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const json = async name => JSON.parse(await readFile(path.join(dist, name), 'utf8'));
const maps = await json('maps.json');
const source = JSON.parse(await readFile(path.join(root, 'source', 'maps-source.json'), 'utf8'));
const titles = JSON.parse(await readFile(path.join(root, 'source', 'map-titles.json'), 'utf8'));
assert.equal(maps.length, 17, 'Retain only the source entries tagged Competitive');
assert.equal(new Set(maps.map(map => map.id)).size, 17, 'Map IDs must be unique');
assert.deepEqual(maps.map(map => map.id), source.map(row => row[0]), 'Catalog must match the inspected Competitive entries');
assert.deepEqual(Object.keys(titles).sort(), maps.map(map => map.id).sort(), 'Verify a full title for every retained map');
const counts = { Convoy: 5, Convergence: 5, Domination: 6, 'Resource Rumble': 1, Arcade: 0 };
for (const [mode, count] of Object.entries(counts)) {
  assert.equal(maps.filter(map => map.mode === mode).length, count, `Wrong ${mode} count`);
}
for (const map of maps) {
  assert.equal(map.location, titles[map.id].location);
  assert.equal(map.fullName, map.location ? `${map.location}: ${map.name}` : map.name, 'Show the complete qualified map name');
  assert.equal(map.fullName, titles[map.id].fullName);
  assert.equal(map.nameSourceUrl, titles[map.id].nameSourceUrl);
  assert.ok(map.nameSourceUrl.startsWith('https://www.marvelrivals.com/'), 'Use official evidence for map names');
  assert.ok(map.sourceUrl === `https://marvelrivals.gg/maps/${map.id}/`, 'Missing exact source');
  assert.equal(map.available, true, 'Every retained Competitive map has a layout');
  assert.equal(map.src, `maps/${map.id}.webp`, 'Use one local annotated file per map');
  const bytes = await readFile(path.join(dist, map.src));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.ok(map.width > 0 && map.height > 0, 'Map dimensions required');
}
assert.deepEqual((await readdir(path.join(dist, 'maps'))).sort(), maps.map(map => `${map.id}.webp`).sort(), 'Ship only the retained map files');
const manifest = await json('manifest.webmanifest');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.name && manifest.start_url && manifest.scope);
for (const icon of manifest.icons) await stat(path.join(dist, icon.src));
for (const name of ['index.html', 'styles.css', 'app.js', 'sw.js']) await stat(path.join(dist, name));
for (const name of ['app.js', 'sw.js', '../scripts/serve.mjs']) {
  const result = spawnSync(process.execPath, ['--check', path.resolve(dist, name)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
console.log('PASS: 17 Competitive entries with verified full titles and local annotated maps, no extra map files, PWA manifest/icons and JavaScript syntax.');
