// Daily end-of-day sync. Vercel calls this on the schedule in vercel.json.
//
// Failure policy, straight from the build brief:
//   - a partial or failed run NEVER overwrites previously synced numbers
//   - the run marks Sync status and raises ONE blocker, updated in place
//   - it flags campaigns for review; it never decides to pause, kill or scale
//   - it never creates decisions or learnings from raw metrics

import { listSyncableCampaigns, buildCampaignProperties, updateCampaign, markSyncStatus }
  from '../lib/notion.js';
import { listCampaigns, getCampaignStats, LgmNotConfiguredError } from '../lib/lgm.js';
import { raiseSyncBlocker, resolveSyncBlocker } from '../lib/blocker.js';

const today = () => new Date().toISOString().slice(0, 10);

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (!authorised(req)) return res.status(401).json({ error: 'unauthorised' });

  const startedAt = new Date().toISOString();
  const result = { startedAt, synced: [], failed: [], skipped: [], flagged: [] };

  let campaigns;
  try {
    campaigns = await listSyncableCampaigns();
  } catch (err) {
    await raiseSyncBlocker({
      impact: 'Critical',
      description: `Could not read Campaigns 2026 from Notion, so nothing was synced. ${err.message}`,
    });
    return res.status(500).json({ ...result, error: err.message });
  }

  if (campaigns.length === 0) {
    await raiseSyncBlocker({
      impact: 'Medium',
      description:
        'No campaign in Campaigns 2026 carries an "LGM campaign ID", so the sync had '
        + 'nothing to match on. Campaigns are matched on that ID and never on name. '
        + 'Fill it in on the live campaigns before expecting numbers to appear.',
    });
    return res.status(200).json({ ...result, note: 'no campaigns carry an LGM campaign ID' });
  }

  // Confirms the LGM side is reachable before touching any Notion row.
  try {
    await listCampaigns();
  } catch (err) {
    const known = err instanceof LgmNotConfiguredError;
    await raiseSyncBlocker({
      impact: known ? 'Critical' : 'High',
      description: known
        ? `${err.message} Notion rows were left untouched; every campaign stays at its `
          + 'existing Sync status rather than being blanked.'
        : `La Growth Machine was unreachable, so no campaign was updated. ${err.message}`,
    });
    // Deliberately does NOT write zeros or blanks to any campaign.
    return res.status(200).json({ ...result, error: err.message, lgmConfigured: !known });
  }

  for (const c of campaigns) {
    try {
      const stats = await getCampaignStats(c.lgmCampaignId);
      const provided = Object.values(stats).filter((v) => v !== undefined && v !== null).length;

      // Flag, do not decide. Only ever fills an EMPTY Decision field.
      const reviewReached = c.reviewDate && c.reviewDate <= today();
      const flagForReview = Boolean(reviewReached && !c.decision);
      if (flagForReview) result.flagged.push(c.name);

      await updateCampaign(
        c.pageId,
        buildCampaignProperties(stats, {
          syncStatus: provided === 0 ? 'Partial' : 'Synced',
          syncedAt: new Date().toISOString(),
          flagForReview,
        })
      );
      result.synced.push({ campaign: c.name, metricsWritten: provided });
    } catch (err) {
      // Mark the row degraded, but leave every number exactly as it was.
      try { await markSyncStatus(c.pageId, 'Failed'); } catch { /* reported below */ }
      result.failed.push({ campaign: c.name, error: err.message });
    }
  }

  if (result.failed.length) {
    await raiseSyncBlocker({
      impact: result.failed.length === campaigns.length ? 'Critical' : 'High',
      description:
        `${result.failed.length} of ${campaigns.length} campaigns failed to sync on `
        + `${startedAt}. Previously synced numbers were left untouched. Failures: `
        + result.failed.map((f) => `${f.campaign} (${f.error})`).join(' | '),
    });
  } else {
    await resolveSyncBlocker(
      `Sync recovered on ${startedAt}: all ${campaigns.length} campaigns updated.`
    );
  }

  return res.status(200).json({ ...result, finishedAt: new Date().toISOString() });
}
