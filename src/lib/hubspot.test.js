import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDealUrl,
  isExpectedPortal,
  mergeCollaborators,
  getDeal,
  findOwnerIdByEmail,
  addCollaborator,
  COLLABORATOR_PROP,
} from './hubspot.js';
import { HUBSPOT } from './config.js';

/** Fake archie.secrets.proxy: routes by method+path, records calls. */
function fakeProxy(routes) {
  const calls = [];
  globalThis.archie = {
    secrets: {
      async proxy(secretName, req) {
        const path = req.url.replace('https://api.hubapi.com', '');
        calls.push({ secretName, method: req.method ?? 'GET', path, headers: req.headers, body: req.body ? JSON.parse(req.body) : undefined });
        const key = `${req.method ?? 'GET'} ${path.split('?')[0]}`;
        const hit = routes[key] ?? routes[`${req.method ?? 'GET'} *`];
        if (!hit) return { status: 404, text: JSON.stringify({ message: 'no route' }) };
        const out = typeof hit === 'function' ? hit(req) : hit;
        return { status: out.status ?? 200, text: JSON.stringify(out.body ?? out) };
      },
    },
  };
  return calls;
}

beforeEach(() => {
  delete globalThis.archie;
});

test('parseDealUrl: classic and record URL shapes, regional hosts, trailing bits; rejects junk', () => {
  assert.deepEqual(parseDealUrl('https://app.hubspot.com/contacts/12345678/deal/987654321'), { portalId: '12345678', dealId: '987654321' });
  assert.deepEqual(parseDealUrl(' https://app-na2.hubspot.com/contacts/12345678/record/0-3/987654321/ '), { portalId: '12345678', dealId: '987654321' });
  assert.deepEqual(parseDealUrl('https://app.hubspot.com/contacts/1/deal/2?interaction=note'), { portalId: '1', dealId: '2' });
  assert.equal(parseDealUrl('https://app.hubspot.com/contacts/1/company/2'), null);
  assert.equal(parseDealUrl('https://evil.example.com/contacts/1/deal/2'), null);
  assert.equal(parseDealUrl('not a url'), null);
  assert.equal(parseDealUrl(''), null);
});

test('isExpectedPortal compares against the configured portal', () => {
  assert.equal(isExpectedPortal(HUBSPOT.portalId), true);
  assert.equal(isExpectedPortal(Number(HUBSPOT.portalId)), true);
  assert.equal(isExpectedPortal('1'), false);
});

test('mergeCollaborators appends without duplicates and never removes', () => {
  assert.deepEqual(mergeCollaborators(null, '5'), ['5']);
  assert.deepEqual(mergeCollaborators('', '5'), ['5']);
  assert.deepEqual(mergeCollaborators('1;2', '5'), ['1', '2', '5']);
  assert.deepEqual(mergeCollaborators('1; 5 ;2', 5), ['1', '5', '2']);
});

test('getDeal: reads name/stage/company/collaborators via the secrets proxy with the token placeholder', async () => {
  const calls = fakeProxy({
    'GET /crm/v3/objects/deals/987654321': {
      id: '987654321',
      properties: { dealname: 'Acme — New Business', dealstage: 'qualifiedtobuy', pipeline: 'default', [COLLABORATOR_PROP]: '1;2' },
      associations: { companies: { results: [{ id: '99' }] } },
    },
    'GET /crm/v3/pipelines/deals/default': { stages: [{ id: 'qualifiedtobuy', label: 'Qualified To Buy' }] },
    'GET /crm/v3/objects/companies/99': { properties: { name: 'Acme Corp' } },
  });
  const d = await getDeal('987654321');
  assert.deepEqual(d, {
    id: '987654321', name: 'Acme — New Business', stageId: 'qualifiedtobuy', stageLabel: 'Qualified To Buy',
    companyId: '99', companyName: 'Acme Corp', collaboratorIds: ['1', '2'],
  });
  assert.equal(calls[0].secretName, HUBSPOT.secretName);
  assert.equal(calls[0].headers.Authorization, 'Bearer {{value}}', 'token is a server-side placeholder, never a value');
});

test('getDeal: no company, unknown stage label falls back to the id; 404 throws with status', async () => {
  fakeProxy({
    'GET /crm/v3/objects/deals/1': { id: '1', properties: { dealname: 'Solo', dealstage: 'x', pipeline: 'p' } },
    'GET /crm/v3/pipelines/deals/p': { status: 500, body: {} },
  });
  const d = await getDeal('1');
  assert.deepEqual([d.companyName, d.stageLabel, d.collaboratorIds], [null, 'x', []]);
  await assert.rejects(getDeal('404'), (e) => e.status === 404 && /no route/.test(e.message));
});

test('findOwnerIdByEmail: exact email match only; null when absent', async () => {
  fakeProxy({ 'GET /crm/v3/owners': (req) => ({ results: /john/.test(req.url) ? [] : [{ id: '1001', email: 'Colin@Example.com' }] }) });
  assert.equal(await findOwnerIdByEmail('colin@example.com'), '1001');
  assert.equal(await findOwnerIdByEmail('john.allman@osano.com'), null);
});

test('addCollaborator: read-modify-write, PATCHes the ";"-joined list', async () => {
  const calls = fakeProxy({
    'GET /crm/v3/objects/deals/7': { id: '7', properties: { [COLLABORATOR_PROP]: '1' } },
    'PATCH /crm/v3/objects/deals/7': { id: '7' },
  });
  const ids = await addCollaborator('7', '5');
  assert.deepEqual(ids, ['1', '5']);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, { properties: { [COLLABORATOR_PROP]: '1;5' } });
});

test('local fallback: without the Archie SDK, requests go to the dev proxy base', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { status: 200, text: async () => JSON.stringify({ results: [] }) }; };
  assert.equal(await findOwnerIdByEmail('x@y.com'), null);
  assert.ok(seen[0].url.startsWith(HUBSPOT.devProxy + '/crm/v3/owners'), seen[0].url);
  assert.equal(seen[0].init.headers.Authorization, undefined, 'no token in the browser request');
  delete globalThis.fetch;
});
