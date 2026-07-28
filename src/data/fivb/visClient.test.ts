import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, parseXml, VisClient } from './visClient.ts';
import { parsePosition } from './importer.ts';

test('parses a flat VIS response', () => {
  const xml = `<?xml version="1.0"?>
    <Response>
      <VolleyPlayer No="100284" FirstName="Yuji" LastName="Nishida" Height="186" SpikeReach="346"/>
      <VolleyPlayer No="100285" FirstName="Ran" LastName="Takahashi" Height="188"/>
    </Response>`;
  const nodes = parseXml(xml);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].tag, 'Response');
  assert.equal(nodes[0].children.length, 2);
  assert.equal(nodes[0].children[0].attrs.FirstName, 'Yuji');
  assert.equal(nodes[0].children[0].attrs.SpikeReach, '346');
  assert.equal(nodes[0].children[1].attrs.Height, '188');
});

test('parses nested elements and collects by tag', () => {
  const xml = `<Response>
      <VolleyTournament No="1" Name="World Championship">
        <VolleyPlayer No="7" FirstName="A" LastName="B"/>
        <VolleyPlayer No="8" FirstName="C" LastName="D"/>
      </VolleyTournament>
    </Response>`;
  const players = collect(parseXml(xml), 'VolleyPlayer');
  assert.equal(players.length, 2);
  assert.equal(players[1].attrs.FirstName, 'C');
});

test('unescapes XML entities in attributes', () => {
  const xml = `<Response><VolleyPlayer LastName="O&apos;Brien" TeamName="A &amp; B"/></Response>`;
  const p = collect(parseXml(xml), 'VolleyPlayer')[0];
  assert.equal(p.attrs.LastName, "O'Brien");
  assert.equal(p.attrs.TeamName, 'A & B');
});

test('handles self-closing and empty responses', () => {
  assert.deepEqual(parseXml('<Response/>')[0].children, []);
  assert.deepEqual(parseXml(''), []);
});

test('maps VIS position codes and names', () => {
  assert.equal(parsePosition('1'), 0); // Setter
  assert.equal(parsePosition('Libero'), 4);
  assert.equal(parsePosition('middle blocker'), 3);
  assert.equal(parsePosition('Wing Spiker'), 2);
  assert.equal(parsePosition(undefined), undefined);
  assert.equal(parsePosition('nonsense'), undefined);
});

test('builds a POST request with the documented shape', async () => {
  let captured: { url: string; body: string; headers: Record<string, string> } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    captured = {
      url,
      body: String(init.body),
      headers: init.headers as Record<string, string>,
    };
    return {
      ok: true,
      status: 200,
      text: async () => '<Response><VolleyPlayer No="5" FirstName="X" LastName="Y"/></Response>',
    };
  }) as unknown as typeof fetch;

  const client = new VisClient({ fetchImpl: fakeFetch, appId: 'test-app', throttleMs: 0 });
  const player = await client.getVolleyPlayer(5);

  assert.ok(captured, 'fetch was not called');
  const cap = captured as unknown as { url: string; body: string; headers: Record<string, string> };
  assert.equal(cap.url, 'https://www.fivb.org/Vis2009/XmlRequest.asmx');
  assert.equal(cap.headers['X-FIVB-App-ID'], 'test-app');
  // The request must be form-encoded under the `Request` key.
  assert.ok(cap.body.startsWith('Request='), 'body must be form-encoded');
  const decoded = decodeURIComponent(cap.body.slice('Request='.length));
  assert.ok(decoded.includes('Type="GetVolleyPlayer"'), decoded);
  assert.ok(decoded.includes('No="5"'), decoded);
  assert.equal(player?.attrs.FirstName, 'X');
});

test('surfaces HTTP errors rather than returning empty data', async () => {
  const fakeFetch = (async () => ({
    ok: false, status: 403, text: async () => 'Forbidden',
  })) as unknown as typeof fetch;
  const client = new VisClient({ fetchImpl: fakeFetch, throttleMs: 0 });
  await assert.rejects(() => client.getVolleyPlayer(1), /HTTP 403/);
});
