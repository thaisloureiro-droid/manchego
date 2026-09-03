// Turns a failed or degraded sync into a row in Blockers / Dependencies,
// rather than a log line nobody reads. Idempotent: one blocker, updated in
// place, never a new row per failed run.

import { notion, BLOCKERS_DS, plain } from './notion.js';

export const SYNC_BLOCKER_TITLE = 'Daily La Growth Machine sync failed';

function daysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function findExisting(title) {
  const res = await notion(`/data_sources/${BLOCKERS_DS}/query`, {
    body: {
      filter: { property: 'Blocker / dependency', title: { equals: title } },
      page_size: 1,
    },
  });
  return res.results[0] || null;
}

export async function raiseSyncBlocker({ description, impact = 'High' }) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await findExisting(SYNC_BLOCKER_TITLE);

  const shared = {
    Status: { select: { name: 'Open' } },
    Impact: { select: { name: impact } },
    'Blocker type': { select: { name: 'Technical' } },
    Owner: { select: { name: 'Thais' } },
    'Next follow-up': { date: { start: daysFromNow(1) } },
    Description: { rich_text: [{ text: { content: description.slice(0, 1900) } }] },
    'Requested action': {
      rich_text: [{
        text: {
          content:
            'Check the Vercel function logs for the failing run, fix the cause, '
            + 'then re-run the sync manually before the next scheduled fire. Do not '
            + 'hand-enter estimates into the synced number fields in the meantime.',
        },
      }],
    },
  };

  // Updating an existing row always works. CREATING one does not: a Notion
  // workspace that has spent its free block allowance returns 403
  // restricted_resource on POST /pages. That must not take the whole sync down -
  // updating campaign numbers is the job that matters, and it still works.
  if (existing) {
    return notion(`/pages/${existing.id}`, { method: 'PATCH', body: { properties: shared } });
  }
  try {
    return await notion('/pages', {
      body: {
        parent: { type: 'data_source_id', data_source_id: BLOCKERS_DS },
        properties: {
          'Blocker / dependency': { title: [{ text: { content: SYNC_BLOCKER_TITLE } }] },
          'Date raised': { date: { start: today } },
          ...shared,
        },
      },
    });
  } catch (err) {
    const capped = /restricted_resource|free blocks/i.test(err.message);
    console.error(
      capped
        ? `Could not create the sync blocker: this Notion workspace has used all its free `
          + `blocks, so nothing new can be created. The condition it would have reported: `
          + description
        : `Could not create the sync blocker: ${err.message}`
    );
    return { created: false, reason: capped ? 'notion_block_limit' : err.message };
  }
}

export async function resolveSyncBlocker(note) {
  const existing = await findExisting(SYNC_BLOCKER_TITLE);
  if (!existing) return null;
  const status = existing.properties.Status?.select?.name;
  if (status === 'Resolved') return null;
  return notion(`/pages/${existing.id}`, {
    method: 'PATCH',
    body: {
      properties: {
        Status: { select: { name: 'Resolved' } },
        Resolution: { rich_text: [{ text: { content: note.slice(0, 1900) } }] },
      },
    },
  });
}

export { plain };
// Turns a failed or degraded sync into a row in Blockers / Dependencies,
// rather than a log line nobody reads. Idempotent: one blocker, updated in
// place, never a new row per failed run.

import { notion, BLOCKERS_DS, plain } from './notion.js';

export const SYNC_BLOCKER_TITLE = 'Daily La Growth Machine sync failed';

function daysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function findExisting(title) {
  const res = await notion(`/data_sources/${BLOCKERS_DS}/query`, {
    body: {
      filter: { property: 'Blocker / dependency', title: { equals: title } },
      page_size: 1,
    },
  });
  return res.results[0] || null;
}

export async function raiseSyncBlocker({ description, impact = 'High' }) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await findExisting(SYNC_BLOCKER_TITLE);

  const shared = {
    Status: { select: { name: 'Open' } },
    Impact: { select: { name: impact } },
    'Blocker type': { select: { name: 'Technical' } },
    Owner: { select: { name: 'Thais' } },
    'Next follow-up': { date: { start: daysFromNow(1) } },
    Description: { rich_text: [{ text: { content: description.slice(0, 1900) } }] },
    'Requested action': {
      rich_text: [{
        text: {
          content:
            'Check the Vercel function logs for the failing run, fix the cause, '
            + 'then re-run the sync manually before the next scheduled fire. Do not '
            + 'hand-enter estimates into the synced number fields in the meantime.',
        },
      }],
    },
  };

  if (existing) {
    return notion(`/pages/${existing.id}`, { method: 'PATCH', body: { properties: shared } });
  }
  return notion('/pages', {
    body: {
      parent: { type: 'data_source_id', data_source_id: BLOCKERS_DS },
      properties: {
        'Blocker / dependency': { title: [{ text: { content: SYNC_BLOCKER_TITLE } }] },
        'Date raised': { date: { start: today } },
        ...shared,
      },
    },
  });
}

export async function resolveSyncBlocker(note) {
  const existing = await findExisting(SYNC_BLOCKER_TITLE);
  if (!existing) return null;
  const status = existing.properties.Status?.select?.name;
  if (status === 'Resolved') return null;
  return notion(`/pages/${existing.id}`, {
    method: 'PATCH',
    body: {
      properties: {
        Status: { select: { name: 'Resolved' } },
        Resolution: { rich_text: [{ text: { content: note.slice(0, 1900) } }] },
      },
    },
  });
}

export { plain };
