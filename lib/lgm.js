// ============================================================================
// THE ADAPTER. This is the only file that knows La Growth Machine's API shape.
//
// STATUS AS OF 3 SEP 2026: NOT CONFIRMED.
//
// Every documented LGM integration checked (Make, Cargo, Pipedream, Zapier)
// exposes only LEAD-level operations - create / update / search / remove a
// lead, update lead status - plus event webhooks. Make's own documentation
// states there is no campaign-listing or campaign-statistics module. One
// third-party wrapper (MindCloud) exposes a list-campaigns call returning
// id, name, status and leadsCount, but no reply, send or meeting counts.
//
// So the daily pull may simply not be possible. Until LGM support confirms
// otherwise, this adapter refuses to run rather than inventing numbers.
//
// TO ENABLE, once you have the real contract:
//   1. Fill in BASE, AUTH_HEADER and the two functions below.
//   2. Set LGM_ENDPOINTS_CONFIRMED=true in the Vercel environment.
// Nothing else in the project needs to change.
// ============================================================================

const BASE = process.env.LGM_API_BASE || 'https://apiv2.lagrowthmachine.com';

export class LgmNotConfiguredError extends Error {
  constructor() {
    super(
      'LGM pull adapter is not configured. No confirmed campaign-statistics '
      + 'endpoint exists yet. Set LGM_ENDPOINTS_CONFIRMED=true and implement '
      + 'lib/lgm.js once LGM support confirms the contract.'
    );
    this.name = 'LgmNotConfiguredError';
    this.expected = true; // a known gap, not a crash - sync.js reports it as such
  }
}

function assertConfigured() {
  if (process.env.LGM_ENDPOINTS_CONFIRMED !== 'true') throw new LgmNotConfiguredError();
  if (!process.env.LGM_API_KEY) throw new Error('LGM_API_KEY is not set.');
}

async function lgm(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      // TODO: confirm with LGM. Candidates seen in the wild: "Authorization:
      // Bearer <key>", "x-api-key: <key>", "apiKey: <key>". Wrong header here
      // usually shows up as a 401, not a helpful error.
      Authorization: `Bearer ${process.env.LGM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LGM ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// Must return: [{ id, name, status }]
export async function listCampaigns() {
  assertConfigured();
  const data = await lgm('/campaigns'); // TODO: confirm path
  const rows = Array.isArray(data) ? data : (data.data || data.campaigns || []);
  return rows.map((c) => ({ id: String(c.id), name: c.name, status: c.status }));
}

// Must return an object using ONLY these keys. Omit - or return undefined for -
// any metric LGM does not provide. Do NOT substitute 0, and do not derive a
// value from another field: a blank in Notion means "not available", and that
// distinction is the whole point.
//
//   accountsPlanned, contactsPlanned, contactsReached, emailMessagesSent,
//   linkedinTouchesSent, positiveReplies, meetingsBooked, meetingsHeld,
//   qualifiedOpportunities, pipelineGenerated, lastActivityDate (YYYY-MM-DD)
export async function getCampaignStats(campaignId) {
  assertConfigured();
  const c = await lgm(`/campaigns/${encodeURIComponent(campaignId)}/stats`); // TODO: confirm path

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  return {
    contactsPlanned: num(c.leadsCount ?? c.enrolled),
    contactsReached: num(c.contacted),
    emailMessagesSent: num(c.emailsSent),
    linkedinTouchesSent: num(c.linkedinActions),
    // NOTE: LGM's "replies" is raw replies, not positive replies. Only map it
    // here if LGM genuinely distinguishes sentiment - otherwise leave it blank
    // and let a human classify. Writing raw replies into "Positive replies"
    // would quietly corrupt the one metric decisions get made on.
    positiveReplies: undefined,
    lastActivityDate: c.lastActivityAt ? String(c.lastActivityAt).slice(0, 10) : undefined,
  };
}
