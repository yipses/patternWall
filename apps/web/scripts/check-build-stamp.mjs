// The build stamp has to be ONE value, not two that happen to agree.
//
// Next evaluates next.config.mjs more than once per build, and a bare
// `new Date()` there gave the prerendered HTML an earlier instant than the
// client bundle. Since the footer renders it to the minute the two agreed
// almost always and diverged exactly when the loads straddled a minute
// boundary -- a text hydration mismatch, which is what the intermittent React
// #418 in the e2e suite turned out to be.
//
// This is a check about the artifact the Pages workflow publishes, for a bug
// that only manifests in a built deploy, and it needs no browser. It lived
// only in the Playwright suite, which the workflow does not run, so it ran on
// developers' machines and nowhere else.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const ISO = /20\d\d-\d\d-\d\dT[\d:.]+Z/g;

const fail = (msg) => { console.error(`build stamp: ${msg}`); process.exit(1); };

const html = readFileSync(join(out, 'index.html'), 'utf8').match(ISO) ?? [];
if (html.length === 0) fail('no build stamp found in the prerendered HTML');

const stamps = new Set(html);
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) for (const m of readFileSync(full, 'utf8').match(ISO) ?? []) stamps.add(m);
  }
};
const before = stamps.size;
walk(join(out, '_next', 'static', 'chunks'));
if (stamps.size === before && before === html.length && html.length === 0) fail('no build stamp found in the client bundle');

if (stamps.size !== 1) {
  fail(`the prerendered HTML and the client bundle disagree about the build time: ${[...stamps].join(' vs ')}`);
}
console.log(`build stamp: one value across HTML and bundle (${[...stamps][0]})`);
