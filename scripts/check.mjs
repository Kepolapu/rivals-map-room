import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const json = async name => JSON.parse(await readFile(path.join(dist, name), 'utf8'));
const maps = await json('maps.json');
assert.equal(maps.length, 39, 'All source catalog entries must be retained');
assert.equal(new Set(maps.map(map => map.id)).size, 39, 'Map IDs must be unique');
const counts = { Convoy: 5, Convergence: 5, Domination: 23, 'Resource Rumble': 1, Arcade: 5 };
for (const [mode, count] of Object.entries(counts)) {
  assert.equal(maps.filter(map => map.mode === mode).length, count, `Wrong ${mode} count`);
}
for (const map of maps) {
  assert.ok(map.sourceUrl === `https://marvelrivals.gg/maps/${map.id}/`, 'Missing exact source');
  if (map.available) {
    assert.equal(map.src, `maps/${map.id}.webp`, 'Use one local annotated file per map');
    const bytes = await readFile(path.join(dist, map.src));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(map.width > 0 && map.height > 0, 'Map dimensions required');
  } else {
    assert.equal(map.id, 'blood-night-new-york-blood-hunt');
    assert.ok(map.unavailableReason, 'Unavailable map must explain the source limitation');
    assert.ok(!map.src, 'Unavailable map must not substitute a different layout');
  }
}
assert.equal(maps.filter(map => map.available).length, 38);
const manifest = await json('manifest.webmanifest');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.name && manifest.start_url && manifest.scope);
for (const icon of manifest.icons) await stat(path.join(dist, icon.src));
for (const name of ['index.html', 'styles.css', 'app.js', 'sw.js']) await stat(path.join(dist, name));
for (const name of ['app.js', 'sw.js', '../scripts/serve.mjs']) {
  const result = spawnSync(process.execPath, ['--check', path.resolve(dist, name)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
console.log('PASS: 39 catalog entries, 38 local annotated maps, source availability, PWA manifest/icons and JavaScript syntax.');
