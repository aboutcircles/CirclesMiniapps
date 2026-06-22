// Deep-link payload tests. Run: `node payload.test.mjs`
// No test framework — just assertions, so it runs against the app's own deps.
//
// The generated share link is a Playground wrapper —
// `/playground?url=<appUrl?data=base64>` — so the payload always reaches the app
// via its OWN `?data=` query. parseGroupPayload must still handle BOTH delivery
// paths, since a registered host would forward app_data instead:
//   1. URL path:   app reads ?data= (base64) off its own URL
//      → parseGroupPayload(str, false)
//   2. app_data:   a host that forwards app_data atob()s it first
//      → parseGroupPayload(str, true)

import assert from 'node:assert/strict';
import { getAddress } from 'viem';
import { buildShareLink, parseGroupPayload, b64encodeUtf8, utf8FromBinary } from './payload.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const GROUP_LOWER = '0xc19bc204eb1c1d5b3fe500e5e5dfabab625f286c';
const GROUP_CHECKSUM = getAddress(GROUP_LOWER);

// Pull the base64 payload back out of a generated share link. The link is a
// Playground wrapper (`/playground?url=<appUrl>`), and the app reads the payload
// off its OWN `?data=` query — exactly what new URLSearchParams does in main.js.
function dataFromLink(link) {
  const appUrl = new URL(link).searchParams.get('url'); // the iframe target
  return new URL(appUrl).searchParams.get('data');      // base64 payload
}
// The two delivery paths parseGroupPayload must handle:
function viaUrl(link) {
  return parseGroupPayload(dataFromLink(link), false); // app reads ?data= itself
}
function viaAppData(link) {
  return parseGroupPayload(atob(dataFromLink(link)), true); // host forwards app_data
}

console.log('payload round-trip');

test('app_data path recovers group + ascii name', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnosis');
  const out = viaAppData(link);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, 'Gnosis');
});

test('url path recovers group + ascii name', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnosis');
  const out = viaUrl(link);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, 'Gnosis');
});

test('checksums a lowercase group address', () => {
  const link = buildShareLink(GROUP_LOWER, '');
  const out = viaUrl(link);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, null);
});

test('unicode name survives app_data path', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnösis 🌐 DAO');
  const out = viaAppData(link);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, 'Gnösis 🌐 DAO');
});

test('unicode name survives url path', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnösis 🌐 DAO');
  const out = viaUrl(link);
  assert.equal(out.name, 'Gnösis 🌐 DAO');
});

test('buildShareLink wraps the app in the host Playground and stays valid', () => {
  const link = buildShareLink(GROUP_LOWER, '🎉🎉🎉');
  const u = new URL(link);
  assert.equal(u.pathname, '/playground');
  const appUrl = u.searchParams.get('url');
  assert.ok(appUrl, 'playground link carries a url= param');
  assert.ok(new URL(appUrl).searchParams.get('data'), 'app url carries ?data=');
});

console.log('payload tolerance');

test('bare 0x address as data (url path)', () => {
  const out = parseGroupPayload(GROUP_LOWER, false);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, null);
});

test('bare 0x address as data (host path)', () => {
  const out = parseGroupPayload(GROUP_CHECKSUM, true);
  assert.equal(out.group, GROUP_CHECKSUM);
});

test('plain base64 JSON (no host involvement) parses on url path', () => {
  const b64 = b64encodeUtf8(JSON.stringify({ group: GROUP_LOWER, name: 'X' }));
  const out = parseGroupPayload(b64, false);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, 'X');
});

test('empty / null / undefined → null', () => {
  assert.equal(parseGroupPayload('', false), null);
  assert.equal(parseGroupPayload(null, true), null);
  assert.equal(parseGroupPayload(undefined, false), null);
});

test('garbage base64 (not json, not address) → null', () => {
  const b64 = b64encodeUtf8('hello world, not a payload');
  assert.equal(parseGroupPayload(b64, false), null);
});

test('json with a non-address group → null', () => {
  const b64 = b64encodeUtf8(JSON.stringify({ group: 'not-an-address' }));
  assert.equal(parseGroupPayload(b64, false), null);
});

test('utf8FromBinary is identity for ascii', () => {
  assert.equal(utf8FromBinary('plain ascii 123'), 'plain ascii 123');
});

console.log(`\n${passed} passed, ${process.exitCode ? 'with failures' : 'all green'}`);
