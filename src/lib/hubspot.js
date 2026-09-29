// HubSpot deal linking (Project Plan §12). No DOM code, no token in code.
//
// Transport: on Archie, every request goes through archie.secrets.proxy(HUBSPOT.secretName, …) so
// the private-app token is injected server-side. On localhost (no SDK) requests go to the local
// dev proxy in scripts/dev-proxy.mjs, which adds the token from an env var. HubSpot's API does not
// allow direct browser calls (no CORS), so there is no third path.
import { HUBSPOT } from './config.js';

const API = 'https://api.hubapi.com';
export const COLLABORATOR_PROP = 'hs_all_collaborator_owner_ids';

/** @typedef {{ portalId: string, dealId: string }} DealRef */

/**
 * Pure. Parse a HubSpot deal record link. Accepts the classic and the newer record URL shapes
 * on any app*.hubspot.com host (regions use app-na2 etc.), with or without trailing paths/query.
 *   https://app.hubspot.com/contacts/244307193/deal/351101839037
 *   https://app-na2.hubspot.com/contacts/244307193/record/0-3/351101839037/
 * @returns {DealRef | null}
 */
export function parseDealUrl(url) {
  let u;
  try {
    u = new URL(String(url ?? '').trim());
  } catch {
    return null;
  }
  if (!/^app(-[a-z0-9]+)?\.hubspot\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/contacts\/(\d+)\/(?:deal|record\/0-3)\/(\d+)(?:\/|$)/);
  return m ? { portalId: m[1], dealId: m[2] } : null;
}

/** Pure. Does this link belong to the portal the app is configured for? */
export function isExpectedPortal(portalId) {
  return String(portalId) === String(HUBSPOT.portalId);
}

/** Pure. HubSpot stores multi-owner properties as ";"-separated ids. Append without removing. */
export function mergeCollaborators(current, ownerId) {
  const ids = String(current ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const id = String(ownerId);
  return ids.includes(id) ? ids : [...ids, id];
}

// ---- transport ----

async function request(path, { method = 'GET', body } = {}) {
  const url = `${API}${path}`;
  const archie = globalThis.archie;
  let status;
  let text;
  if (archie?.secrets?.proxy) {
    const res = await archie.secrets.proxy(HUBSPOT.secretName, {
      url,
      method,
      headers: { Authorization: 'Bearer {{value}}', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    status = res.status;
    text = res.text ?? '';
  } else {
    let res;
    try {
      res = await fetch(`${HUBSPOT.devProxy}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      // A network-level failure here almost always means the local proxy isn't running.
      throw Object.assign(
        new Error(`HubSpot dev proxy not reachable at ${HUBSPOT.devProxy} — run \`HUBSPOT_TOKEN=… npm run dev:hubspot\` (${err.message})`),
        { status: 0 },
      );
    }
    status = res.status;
    text = await res.text();
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (status < 200 || status >= 300) {
    const msg = json?.message ?? text?.slice(0, 200) ?? '';
    throw Object.assign(new Error(`HubSpot ${method} ${path} failed: ${status} ${msg}`.trim()), { status });
  }
  return json;
}

// ---- reads ----

/**
 * Fetch what the AE needs to confirm the right record: name, stage label, company name, and the
 * current collaborator ids.
 * @returns {Promise<{ id: string, name: string, stageId: string, stageLabel: string, companyId: string|null, companyName: string|null, collaboratorIds: string[] }>}
 */
export async function getDeal(dealId) {
  const q = `properties=dealname,dealstage,pipeline,${COLLABORATOR_PROP}&associations=companies`;
  const deal = await request(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}?${q}`);
  const p = deal.properties ?? {};
  const companyId = deal.associations?.companies?.results?.[0]?.id ?? null;

  const [stageLabel, companyName] = await Promise.all([
    stageLabelFor(p.pipeline, p.dealstage),
    companyId ? companyNameFor(companyId) : null,
  ]);

  return {
    id: String(deal.id),
    name: p.dealname ?? '',
    stageId: p.dealstage ?? '',
    stageLabel,
    companyId,
    companyName,
    collaboratorIds: mergeCollaborators(p[COLLABORATOR_PROP], '').filter(Boolean),
  };
}

const stageCache = new Map(); // pipelineId → Map(stageId → label)

async function stageLabelFor(pipelineId, stageId) {
  if (!pipelineId || !stageId) return stageId ?? '';
  if (!stageCache.has(pipelineId)) {
    try {
      const pl = await request(`/crm/v3/pipelines/deals/${encodeURIComponent(pipelineId)}`);
      stageCache.set(pipelineId, new Map((pl.stages ?? []).map((s) => [s.id, s.label])));
    } catch {
      return stageId; // label is a nicety; never block on it
    }
  }
  return stageCache.get(pipelineId).get(stageId) ?? stageId;
}

async function companyNameFor(companyId) {
  try {
    const c = await request(`/crm/v3/objects/companies/${encodeURIComponent(companyId)}?properties=name`);
    return c.properties?.name ?? null;
  } catch {
    return null;
  }
}

/** The HubSpot owner id for a user email, or null if that email is not a user in the portal. */
export async function findOwnerIdByEmail(email) {
  const res = await request(`/crm/v3/owners?email=${encodeURIComponent(email)}&limit=1`);
  const owner = (res.results ?? []).find((o) => String(o.email ?? '').toLowerCase() === String(email).toLowerCase());
  return owner ? String(owner.id) : null;
}

// ---- the one write ----

/**
 * Append an owner to the deal's Deal Collaborators. Read-modify-write; never removes anyone.
 * @returns {Promise<string[]>} the collaborator ids after the write
 */
export async function addCollaborator(dealId, ownerId) {
  const deal = await request(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${COLLABORATOR_PROP}`);
  const ids = mergeCollaborators(deal.properties?.[COLLABORATOR_PROP], ownerId);
  await request(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
    method: 'PATCH',
    body: { properties: { [COLLABORATOR_PROP]: ids.join(';') } },
  });
  return ids;
}
