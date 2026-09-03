// Read-only pulls from Notion for the dashboard.
//
// Reads do not consume Notion blocks, so this works on any plan - including a
// workspace that has exhausted its free block allowance and can no longer
// CREATE content. That is the whole reason the dashboard reads rather than writes.

import { notion, plain, CAMPAIGNS_DS, BLOCKERS_DS } from './notion.js';

export const DECISIONS_DS = process.env.NOTION_DECISIONS_DATA_SOURCE_ID
  || '0eab1a1d-c451-442a-80bd-c152672898e2';
export const LEARNINGS_DS = process.env.NOTION_LEARNINGS_DATA_SOURCE_ID
  || '86c48f47-b93f-429c-ab6d-306a69973f1f';

const n = (p) => (typeof p?.number === 'number' ? p.number : null);
const sel = (p) => p?.select?.name || null;
const dt = (p) => p?.date?.start || null;
const txt = (p) => plain(p?.rich_text);

async function queryAll(ds, body = {}) {
  const out = [];
  let cursor;
  do {
    const page = await notion(`/data_sources/${ds}/query`, {
      body: { page_size: 100, start_cursor: cursor, ...body },
    });
    out.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function getCampaigns() {
  const rows = await queryAll(CAMPAIGNS_DS);
  return rows.map((p) => {
    const q = p.properties;
    return {
      url: p.url,
      name: plain(q.Campaign?.title),
      status: sel(q.Status),
      owner: sel(q['Rep Owner']),
      icp: sel(q.ICP),
      decision: sel(q.Decision),
      syncStatus: sel(q['Sync status']),
      startDate: dt(q['Start date']),
      reviewDate: dt(q['End / review date']),
      lastSynced: dt(q['Last synced at']),
      lgmId: txt(q['LGM campaign ID']),
      successCriteria: txt(q['Success criteria']),
      nextAction: txt(q['Next action']),
      accountsPlanned: n(q['Accounts planned']),
      contactsPlanned: n(q['Contacts planned']),
      contactsReached: n(q['Contacts reached']),
      emailsSent: n(q['Email messages sent']),
      linkedinTouches: n(q['LinkedIn touches sent']),
      positiveReplies: n(q['Positive replies']),
      meetingsBooked: n(q['Meetings set']),
      meetingsHeld: n(q['Meetings held']),
      qualifiedOpps: n(q['Qualified opportunities']),
      pipeline: n(q['Pipeline generated']),
    };
  });
}

export async function getOpenDecisions() {
  const rows = await queryAll(DECISIONS_DS, {
    filter: { property: 'Status', select: { equals: 'Open' } },
    sorts: [{ property: 'Review date', direction: 'ascending' }],
  });
  return rows.map((p) => {
    const q = p.properties;
    return {
      url: p.url,
      title: plain(q.Decision?.title),
      owner: sel(q['Decision owner']),
      type: sel(q['Decision type']),
      reviewDate: dt(q['Review date']),
      context: txt(q.Context),
    };
  });
}

export async function getActiveBlockers() {
  const rows = await queryAll(BLOCKERS_DS, {
    filter: {
      or: [
        { property: 'Status', select: { equals: 'Open' } },
        { property: 'Status', select: { equals: 'In progress' } },
        { property: 'Status', select: { equals: 'Waiting on others' } },
      ],
    },
  });
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return rows.map((p) => {
    const q = p.properties;
    return {
      url: p.url,
      title: plain(q['Blocker / dependency']?.title),
      status: sel(q.Status),
      impact: sel(q.Impact),
      owner: sel(q.Owner),
      externalOwner: txt(q['External owner']),
      nextFollowUp: dt(q['Next follow-up']),
      neededBy: dt(q['Needed by']),
      requestedAction: txt(q['Requested action']),
    };
  }).sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
}

export async function getLearnings(limit = 6) {
  const rows = await queryAll(LEARNINGS_DS, {
    sorts: [{ property: 'Date captured', direction: 'descending' }],
  });
  return rows.slice(0, limit).map((p) => {
    const q = p.properties;
    return {
      url: p.url,
      title: plain(q.Learning?.title),
      confidence: sel(q.Confidence),
      type: sel(q['Learning type']),
      status: sel(q.Status),
      implication: txt(q.Implication),
    };
  });
}
