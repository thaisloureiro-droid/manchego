// LGM event receiver.
//
// LGM's webhook form offers only Name, Description and a URL - there is NO
// custom-header field. So the shared secret travels as a query parameter:
//
//   https://<app>.vercel.app/api/webhook?secret=<LGM_WEBHOOK_SECRET>
//
// A URL secret is weaker than a header (it can land in logs and referrers).
// It is what LGM supports, so it is what we use - and it is why the secret is
// long and random, and why rotating it is cheap: change the env var, change
// the URL in LGM.
//
// LGM fires this when a "Webhook" ACTION is reached inside a sequence - it is
// not an automatic feed of every send and reply. The payload shape is not
// documented, so until a real one has been seen this handler runs in DISCOVERY
// MODE: it logs the entire body, and only increments a counter when it can
// recognise the shape with confidence. It never guesses.

import { notion, CAMPAIGNS_DS, plain, getCampaignNumbers, updateCampaign } from '../lib/notion.js';

// An LGM "reply" is a RAW reply, so it is deliberately never written to
// "Positive replies" - a human classifies sentiment at the weekly review.
// Writing raw replies there would corrupt the metric decisions are made on.
const EVENT_TO_PROPERTY = {
  email_sent: 'Email messages sent',
  emailSent: 'Email messages sent',
  linkedin_message_sent: 'LinkedIn touches sent',
  linkedinMessageSent: 'LinkedIn touches sent',
  linkedin_invite_accepted: 'LinkedIn touches sent',
  lead_contacted: 'Contacts reached',
  leadContacted: 'Contacts reached',
};

function authorised(req) {
  const secret = process.env.LGM_WEBHOOK_SECRET;
  if (!secret) return false;
  const fromHeader = req.headers['x-webhook-secret'];
  const url = new URL(req.url, 'https://placeholder.local');
  const fromQuery = url.searchParams.get('secret');
  return fromHeader === secret || fromQuery === secret;
}

// Pulls the campaign id out of whatever LGM sends, without inventing one.
function findCampaignId(body) {
  const candidates = [
    body?.campaignId, body?.campaign_id, body?.campaign?.id,
    body?.campaignID, body?.data?.campaignId, body?.data?.campaign?.id,
  ];
  const hit = candidates.find((v) => v !== undefined && v !== null && v !== '');
  return hit === undefined ? null : String(hit);
}

function findEventType(body) {
  return body?.type || body?.event || body?.eventType || body?.action || null;
}

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
  // LGM's "Test webhook" button may send GET. Answer it, so the test succeeds
  // and the endpoint is visibly reachable.
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      endpoint: 'lgm-webhook',
      authorised: authorised(req),
      note: 'Reachable. POST a real event to see it captured in the Vercel logs.',
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST or GET only' });

  if (!authorised(req)) {
    return res.status(401).json({
      error: 'unauthorised',
      note: 'Append ?secret=<LGM_WEBHOOK_SECRET> to the URL, or send the x-webhook-secret header.',
    });
  }

  const body = req.body || {};

  // DISCOVERY: the full payload, every time. This is how the real shape gets
  // learned - read it in the Vercel function logs after a test fire.
  console.log('[LGM webhook] payload:', JSON.stringify(body).slice(0, 4000));

  const type = findEventType(body);
  const lgmCampaignId = findCampaignId(body);
  const eventId = body?.id || body?.eventId || body?.data?.id || null;

  // Unrecognised is ACKNOWLEDGED, not an error - a 4xx makes LGM retry, and a
  // retry storm on a shape we cannot read helps nobody. The log above is the
  // useful output.
  if (!type || !lgmCampaignId) {
    return res.status(200).json({
      captured: true,
      recognised: false,
      sawType: type,
      sawCampaignId: lgmCampaignId,
      note: 'Payload logged for inspection. Nothing was written to Notion - the shape is not '
        + 'recognised yet, and guessing would put invented numbers on the scorecard.',
    });
  }

  const property = EVENT_TO_PROPERTY[type];
  if (!property) {
    return res.status(200).json({ captured: true, recognised: false, ignoredType: type });
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

  return res.status(200).json({
    recognised: true,
    campaign: plain(page.properties.Campaign?.title),
    property,
  });
}
