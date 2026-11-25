import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, safeFetchText } from '../server/extras.js';

test('parseFeed reads RSS items, CDATA and entities', () => {
  const xml = `<rss><channel><title>My &amp; Feed</title>
    <item><title><![CDATA[Hello <b>world</b>]]></title><link>https://e.com/1</link><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Fish &amp; Chips</title><link>https://e.com/2</link></item></channel></rss>`;
  const items = parseFeed(xml, 'fallback');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Hello world');
  assert.equal(items[1].title, 'Fish & Chips');
  assert.equal(items[0].source, 'My & Feed');
  assert.equal(items[0].link, 'https://e.com/1');
  assert.ok(items[0].at > 0);
});

test('parseFeed reads Atom entries (href links)', () => {
  const xml = `<feed><title>Atom</title><entry><title>One</title><link href="https://a.com/1"/><updated>2026-11-24T10:00:00Z</updated></entry></feed>`;
  const [i] = parseFeed(xml, 'x');
  assert.equal(i.title, 'One'); assert.equal(i.link, 'https://a.com/1'); assert.ok(i.at > 0);
});

test('parseFeed never returns a non-http link and skips untitled items', () => {
  const xml = `<rss><channel><item><title>Bad</title><link>javascript:alert(1)</link></item><item><link>https://x.com</link></item></channel></rss>`;
  const items = parseFeed(xml, 'x');
  assert.equal(items.length, 1);
  assert.equal(items[0].link, '', 'javascript: links must be dropped');
});

test('parseFeed caps the number of items', () => {
  const xml = `<rss><channel>${Array.from({ length: 40 }, (_, i) => `<item><title>T${i}</title></item>`).join('')}</channel></rss>`;
  assert.ok(parseFeed(xml, 'x').length <= 15);
});

// A feed URL is user input and the server runs inside your network: it must never be able to reach private addresses.
for (const [url, why] of [
  ['http://example.com/feed', 'plain http'],
  ['https://127.0.0.1/', 'loopback'],
  ['https://localhost/', 'localhost name'],
  ['https://10.0.0.5/', '10.x private'],
  ['https://172.16.0.1/', '172.16 private'],
  ['https://192.168.1.1/', '192.168 private'],
  ['https://169.254.169.254/latest/meta-data', 'cloud metadata'],
  ['https://100.64.0.1/', 'carrier-grade NAT'],
  ['https://[::1]/', 'IPv6 loopback'],
  ['https://[fd00::1]/', 'IPv6 unique-local'],
  ['https://user:pw@example.com/', 'credentials in the URL'],
  ['https://example.com:8443/', 'non-standard port'],
  ['ftp://example.com/', 'other protocol'],
]) {
  test(`safeFetchText refuses ${why}: ${url}`, async () => {
    await assert.rejects(() => safeFetchText(url));
  });
}
