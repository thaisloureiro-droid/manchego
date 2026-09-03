// LGM event receiver - the fallback route, and the one that works whether or
// not a campaign-statistics endpoint ever exists.
//
// LGM posts per-lead events (accepted, replied, clicked, converted). This
// accumulates them into the campaign's counters.
//
// TWO THINGS TO UNDERSTAND BEFORE TRUSTING THE NUMBERS:
//
//  1. It counts from the day you switch it on. It cannot backfill. The 17 Aug
//     audit figures will never be reproduced by this route.
//  2. Read-modify-write on a Notion number is not atomic. Two events for the
//     same campaign in the same second can lose a count. At CKL's volumes
//     (tens of contacts per campaign) that is unlikely but not impossible.
//     Set DEDUPE_KV_URL / DEDUPE_KV_TOKEN to enable event-ID dedupe; without
//     it, an LGM retry will double-count.

import { notion, CAMPAIGNS_DS, plain, getCampaignNumbers, updateCampaign } from '../lib/notion.js';

// Only events that map cleanly onto a counter are handled. An LGM "reply" is a
// RAW reply, so it is deliberately NOT written to "Positive replies" - a human
// classifies sentiment at the weekly review. Raw replies land nowhere rather
// than corrupting the metric decisions are made on.
const EVENT_TO_PROPERTY = {
  email_sent: 'Email messages sent',
  linkedin_message_sent: 'LinkedIn touches sent',
  linkedin_invite_accepted: 'LinkedIn touches sent',
  lead_contacted: 'Contacts reached',
};

async function alreadySeen(eventId) {
  const url = process.env.DEDUPE_KV_URL;
  const token = process.env.DEDUPE_KV_TOKEN;
  if (!url || !token || !eventId) return false;
  const res = await fetch(`${url}/set/lgm:${encodeURIComponent(eventId)}/1?NX=true&EX=604800`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return body.result === null; // NX failed => key existed => duplicate
}

async function findCampaignByLgmId(lgmCampaignId) {
  const res = await notion(`/data_sources/${CAMPAIGNS_DS}/query`, {
    body: {
      filter: { property: 'LGM campaign ID', rich_text: { equals: String(lgmCampaignId) } },
      page_size: 2,
    },
  });
  if (res.results.length > 1) {
    throw new Error(
      `Two campaigns share LGM campaign ID ${lgmCampaignId}. Fix the duplicate before trusting counts.`
    );
  }
  return res.results[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Without this, anyone who finds the URL can inflate your pipeline numbers.
  const secret = process.env.LGM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-webhook-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorised' });
  }

  const event = req.body || {};
  const type = event.type || event.event;
  const lgmCampaignId = event.campaignId || event.campaign_id;
  const eventId = event.id || event.eventId;

  if (!type || !lgmCampaignId) {
    return res.status(400).json({ error: 'event needs a type and a campaignId' });
  }

  const property = EVENT_TO_PROPERTY[type];
  if (!property) {
    // Unmapped events are acknowledged, not errors - LGM should not retry them.
    return res.status(200).json({ ignored: type });
  }

  if (await alreadySeen(eventId)) return res.status(200).json({ duplicate: eventId });

  const page = await findCampaignByLgmId(lgmCampaignId);
  if (!page) {
    return res.status(202).json({
      unmatched: lgmCampaignId,
      note: 'No Campaigns 2026 row carries this LGM campaign ID. Event dropped, nothing invented.',
    });
  }

  const current = await getCampaignNumbers(page.id, [property]);
  await updateCampaign(page.id, {
    [property]: { number: (current[property] ?? 0) + 1 },
    'Last activity date': { date: { start: new Date().toISOString().slice(0, 10) } },
    'Last synced at': { date: { start: new Date().toISOString() } },
    'Sync status': { select: { name: 'Synced' } },
  });

  return res.status(200).json({ campaign: plain(page.properties.Campaign?.title), property });
}
