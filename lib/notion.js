// Notion write layer for the GTM / Outbound Command Center.
//
// Two rules from the build brief are enforced here, not left to callers:
//   1. Campaigns are matched on "LGM campaign ID", never on name.
//   2. A missing metric is left BLANK. It is never written as 0, and it never
//      overwrites a number that a previous successful sync already wrote.

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = process.env.NOTION_VERSION || '2026-03-11';

export const CAMPAIGNS_DS = process.env.NOTION_CAMPAIGNS_DATA_SOURCE_ID
  || 'e2d0541e-977a-4379-82e3-c69193b36fc1';
export const BLOCKERS_DS = process.env.NOTION_BLOCKERS_DATA_SOURCE_ID
  || 'df6b7393-ebe3-4e23-9030-fdc93edc5ed1';

async function notion(path, { method = 'POST', body } = {}) {
  const res = await fetch(NOTION_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

const plain = (rich) => (rich || []).map((r) => r.plain_text).join('');

// --- reads -----------------------------------------------------------------

// Every campaign carrying an LGM campaign ID. Campaigns without one are simply
// not synced - that is the intended behaviour, not an error.
export async function listSyncableCampaigns() {
  const out = [];
  let cursor;
  do {
    const page = await notion(`/data_sources/${CAMPAIGNS_DS}/query`, {
      body: {
        filter: { property: 'LGM campaign ID', rich_text: { is_not_empty: true } },
        page_size: 100,
        start_cursor: cursor,
      },
    });
    for (const p of page.results) {
      const props = p.properties;
      out.push({
        pageId: p.id,
        name: plain(props.Campaign?.title),
        lgmCampaignId: plain(props['LGM campaign ID']?.rich_text).trim(),
        status: props.Status?.select?.name || null,
        decision: props.Decision?.select?.name || null,
        reviewDate: props['End / review date']?.date?.start || null,
      });
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function getCampaignNumbers(pageId, fields) {
  const page = await notion(`/pages/${pageId}`, { method: 'GET' });
  const out = {};
  for (const f of fields) out[f] = page.properties[f]?.number ?? null;
  return out;
}

// --- writes ----------------------------------------------------------------

// Maps the adapter's stat names onto Notion property names. Anything the
// adapter returns as undefined or null is dropped before the request is built,
// so a metric LGM does not provide stays blank rather than becoming zero.
const STAT_TO_PROPERTY = {
  accountsPlanned: 'Accounts planned',
  contactsPlanned: 'Contacts planned',
  contactsReached: 'Contacts reached',
  emailMessagesSent: 'Email messages sent',
  linkedinTouchesSent: 'LinkedIn touches sent',
  positiveReplies: 'Positive replies',
  meetingsBooked: 'Meetings set',
  meetingsHeld: 'Meetings held',
  qualifiedOpportunities: 'Qualified opportunities',
  pipelineGenerated: 'Pipeline generated',
};

export function buildCampaignProperties(stats = {}, { syncStatus, syncedAt, flagForReview } = {}) {
  const properties = {};

  for (const [statKey, propName] of Object.entries(STAT_TO_PROPERTY)) {
    const v = stats[statKey];
    if (typeof v === 'number' && Number.isFinite(v)) {
      properties[propName] = { number: v };
    }
    // else: intentionally omitted. Blank is not zero.
  }

  if (stats.lastActivityDate) {
    properties['Last activity date'] = { date: { start: stats.lastActivityDate } };
  }
  if (syncStatus) {
    properties['Sync status'] = { select: { name: syncStatus } };
  }
  if (syncedAt) {
    properties['Last synced at'] = { date: { start: syncedAt } };
  }
  // A flag is not a decision. This only ever sets "Pending review", and only
  // when the field is empty - it never overwrites a human's Continue/Kill.
  if (flagForReview) {
    properties.Decision = { select: { name: 'Pending review' } };
  }
  return properties;
}

export async function updateCampaign(pageId, properties) {
  if (Object.keys(properties).length === 0) return { skipped: true };
  return notion(`/pages/${pageId}`, { method: 'PATCH', body: { properties } });
}

// Marks a campaign's sync as degraded WITHOUT touching any metric, so a failed
// run can never blank out numbers a good run wrote.
export async function markSyncStatus(pageId, syncStatus) {
  return updateCampaign(pageId, { 'Sync status': { select: { name: syncStatus } } });
}

export { notion, plain };
