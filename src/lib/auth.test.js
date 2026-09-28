import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// auth.js keeps a module-level token client, so import it fresh per test via a cache-busting query.
let n = 0;
const freshAuth = () => import(`./auth.js?v=${n++}`);

/** A fake Google Identity Services global. `behaviour` decides what requestAccessToken does. */
function installFakeGis(behaviour) {
  const calls = [];
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(cfg) {
          calls.push({ init: cfg });
          return {
            requestAccessToken(over) {
              calls.push({ request: over });
              setTimeout(() => behaviour(cfg, over), 0);
            },
          };
        },
      },
    },
  };
  return calls;
}

beforeEach(() => {
  delete globalThis.google;
  delete globalThis.archie;
});

test('resolves with the token and an expiry derived from expires_in', async () => {
  installFakeGis((cfg) => cfg.callback({ access_token: 'tok', expires_in: 3599 }));
  const { requestAccessToken } = await freshAuth();
  const before = Date.now();
  const { accessToken, expiresAt } = await requestAccessToken({ hint: 'ae@osano.com' });
  assert.equal(accessToken, 'tok');
  assert.ok(expiresAt >= before + 3599_000 && expiresAt <= Date.now() + 3599_000);
});

test('sends prompt "" and the email hint on every request; silent and interactive look the same to Google', async () => {
  const calls = installFakeGis((cfg) => cfg.callback({ access_token: 'tok', expires_in: 3600 }));
  const { requestAccessToken } = await freshAuth();
  await requestAccessToken({ silent: true, hint: 'ae@osano.com' });
  await requestAccessToken({ hint: 'ae@osano.com' });
  const reqs = calls.filter((c) => c.request).map((c) => c.request);
  assert.deepEqual(reqs, [
    { prompt: '', hint: 'ae@osano.com' },
    { prompt: '', hint: 'ae@osano.com' },
  ]);
  assert.equal(calls.filter((c) => c.init).length, 1, 'token client is created once and reused');
  assert.equal(calls[0].init.client_id.length > 0, true);
});

test('omits hint when none is given', async () => {
  const calls = installFakeGis((cfg) => cfg.callback({ access_token: 'tok' }));
  const { requestAccessToken } = await freshAuth();
  const { expiresAt } = await requestAccessToken();
  assert.deepEqual(calls[1].request, { prompt: '' });
  assert.ok(expiresAt > Date.now() + 3500_000, 'missing expires_in assumes ~1 hour');
});

test('a blocked popup (silent attempt with no user gesture) rejects with a code', async () => {
  installFakeGis((cfg) => cfg.error_callback({ type: 'popup_failed_to_open' }));
  const { requestAccessToken } = await freshAuth();
  await assert.rejects(requestAccessToken({ silent: true, hint: 'ae@osano.com' }), (err) => {
    assert.equal(err.code, 'popup_failed_to_open');
    return true;
  });
});

test('an OAuth error in the callback rejects with its code', async () => {
  installFakeGis((cfg) => cfg.callback({ error: 'access_denied' }));
  const { requestAccessToken } = await freshAuth();
  await assert.rejects(requestAccessToken(), (err) => err.code === 'access_denied');
});

test('a second request while one is in flight is refused, and the first still resolves', async () => {
  installFakeGis((cfg) => setTimeout(() => cfg.callback({ access_token: 'tok', expires_in: 3600 }), 20));
  const { requestAccessToken } = await freshAuth();
  const first = requestAccessToken({ silent: true });
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(requestAccessToken(), (err) => err.code === 'in_progress');
  assert.equal((await first).accessToken, 'tok');
});

test('getMe: Archie identity when present, DEV_EMAIL otherwise', async () => {
  const { getMe, } = await freshAuth();
  assert.equal(await getMe(), 'creinhardt@osano.com');
  globalThis.archie = { me: async () => ({ email: 'ae@osano.com', name: 'An AE' }) };
  assert.equal(await getMe(), 'ae@osano.com');
});
