// Deep-link payload tests. Run: `node payload.test.mjs`
// No test framework — just assertions, so it runs against the app's own deps.
//
// The critical thing under test is the round-trip through BOTH delivery paths:
//   1. Host path:  host does atob(?data=) and posts the binary string to
//      onAppData  → parseGroupPayload(str, true)
//   2. URL path:   standalone/direct open reads ?data= (base64) off the URL
//      → parseGroupPayload(str, false)

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

// Simulate exactly what the host does with a generated link:
// SvelteKit reads url.searchParams.get('data') (percent-decoded → base64),
// then posts atob(base64) to the iframe, which onAppData hands to us.
function hostDeliver(link) {
  const dataParam = new URL(link).searchParams.get('data'); // percent-decoded base64
  return atob(dataParam); // binary string the iframe receives
}
function urlDeliver(link) {
  return new URL(link).searchParams.get('data'); // base64 (URL fallback path)
}

console.log('payload round-trip');

test('host path recovers group + ascii name', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnosis');
  const out = parseGroupPayload(hostDeliver(link), true);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, 'Gnosis');
});

test('url fallback path recovers group + ascii name', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnosis');
  const out = parseGroupPayload(urlDeliver(link), false);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, 'Gnosis');
});

test('checksums a lowercase group address', () => {
  const link = buildShareLink(GROUP_LOWER, '');
  const out = parseGroupPayload(hostDeliver(link), true);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, null);
});

test('unicode name survives host path', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnösis 🌐 DAO');
  const out = parseGroupPayload(hostDeliver(link), true);
  assert.equal(out.group, GROUP_CHECKSUM);
  assert.equal(out.name, 'Gnösis 🌐 DAO');
});

test('unicode name survives url path', () => {
  const link = buildShareLink(GROUP_LOWER, 'Gnösis 🌐 DAO');
  const out = parseGroupPayload(urlDeliver(link), false);
  assert.equal(out.name, 'Gnösis 🌐 DAO');
});

test('buildShareLink never throws on emoji and stays a valid URL', () => {
  const link = buildShareLink(GROUP_LOWER, '🎉🎉🎉');
  const u = new URL(link);
  assert.equal(u.pathname, '/miniapps/affiliate-link');
  assert.ok(u.searchParams.get('data'));
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
