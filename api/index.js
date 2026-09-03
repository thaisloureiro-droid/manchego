// The Command Center as a hosted page.
//
// Server-renders on request from Notion, which is READ-ONLY here - reads do not
// consume Notion blocks, so this works even on a workspace that has exhausted
// its free block allowance and can no longer create content.
//
// Notion stays the place you edit. This is the surface you look at and share.

import { getCampaigns, getOpenDecisions, getActiveBlockers, getLearnings } from '../lib/read.js';
import { esc, num, total, BLANK, impactPill, statusPill, dueLabel, daysUntil } from '../lib/render.js';

const LIBRARY = 'https://app.notion.com/p/3bb128c7590e81de8a8bfb2d0a0c4449';
const COMMAND_CENTER = 'https://app.notion.com/p/3d0128c7590e81689536f687cccc0cbc';

const CSS = `
:root{color-scheme:light;--plane:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;
--muted:#898781;--rule:#e1e0d9;--border:rgba(11,11,11,.10);
--good:#0ca30c;--warning:#fab219;--serious:#ec835a;--critical:#d03b3b;--accent:#2a78d6}
@media(prefers-color-scheme:dark){:root:where(:not([data-theme=light])){color-scheme:dark;
--plane:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;
--rule:#2c2c2a;--border:rgba(255,255,255,.10);--accent:#3987e5}}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);
font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:32px 20px 72px}
h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:15px;margin:0;letter-spacing:-.005em}
a{color:inherit}
.sub{color:var(--ink2);font-size:13px;margin:0}
.note{color:var(--muted);font-size:12px}
.blank{color:var(--muted)}
header{margin-bottom:20px}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12px;color:var(--muted)}
.banner{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--warning);
border-radius:8px;padding:12px 14px;margin-bottom:24px;font-size:13px;color:var(--ink2)}
.banner b{color:var(--ink)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:32px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.tile .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;
margin-bottom:6px;line-height:1.3}
.tile .v{font-size:24px;font-weight:600;letter-spacing:-.02em}
.tile .src{font-size:11px;color:var(--muted);margin-top:3px}
section{margin-bottom:34px}
.shead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
.scroll{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;
letter-spacing:.04em;font-weight:600;padding:10px 12px;border-bottom:1px solid var(--rule);
white-space:nowrap}
td{padding:11px 12px;border-bottom:1px solid var(--rule);vertical-align:top}
tr:last-child td{border-bottom:0}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
th.n{text-align:right}
.name{font-weight:600;min-width:210px}
.name a{text-decoration:none}
.name a:hover{text-decoration:underline}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;
padding:2px 8px;border-radius:999px;white-space:nowrap;
border:1px solid var(--border);color:var(--ink2)}
.pill.good{color:var(--good)}.pill.warning{color:var(--warning)}
.pill.serious{color:var(--serious)}.pill.critical{color:var(--critical)}
.pill.muted{color:var(--muted)}
.cell-note{color:var(--ink2);font-size:12px;margin-top:3px;max-width:380px}
.empty{padding:16px;color:var(--muted);font-size:13px}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--rule);
font-size:12px;color:var(--muted)}
footer a{color:var(--accent)}
`;

function tile(label, value, source) {
  return `<div class="tile"><div class="k">${esc(label)}</div><div class="v">${value}</div>
  <div class="src">${esc(source)}</div></div>`;
}

function page(body, generated) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GTM / Outbound Command Center</title><style>${CSS}</style></head>
<body><div class="wrap">${body}
<footer>Reads live from Notion each time you load it &middot; rendered ${esc(generated)} &middot;
Notion is still where you edit &mdash; <a href="${COMMAND_CENTER}">open the Command Center</a> or the
<a href="${LIBRARY}">Reference Library</a>.</footer></div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!process.env.NOTION_TOKEN) {
    return res.status(500).send(page(
      `<h1>Not configured</h1><p class="sub">NOTION_TOKEN is not set on this deployment.</p>`,
      new Date().toUTCString()
    ));
  }

  let campaigns; let decisions; let blockers; let learnings;
  try {
    [campaigns, decisions, blockers, learnings] = await Promise.all([
      getCampaigns(), getOpenDecisions(), getActiveBlockers(), getLearnings(),
    ]);
  } catch (err) {
    return res.status(502).send(page(
      `<h1>Could not read Notion</h1><p class="sub">${esc(err.message)}</p>
       <p class="note">Most often this means the integration has not been shared with the
       databases, or the token is wrong.</p>`,
      new Date().toUTCString()
    ));
  }

  const live = campaigns.filter((c) => c.status === 'Live');
  const scored = live.length ? live : campaigns;
  const anySynced = campaigns.some((c) => c.syncStatus === 'Synced');

  const K = [
    ['Accounts targeted', total(scored, 'accountsPlanned'), 'planned, Notion'],
    ['Contacts reached', total(scored, 'contactsReached'), 'LGM audit, manual'],
    ['Emails sent', total(scored, 'emailsSent'), 'LGM sync'],
    ['LinkedIn touches', total(scored, 'linkedinTouches'), 'LGM sync'],
    ['Positive replies', total(scored, 'positiveReplies'), 'human-classified'],
    ['Meetings booked', total(scored, 'meetingsBooked'), 'manual'],
    ['Meetings held', total(scored, 'meetingsHeld'), 'manual'],
    ['Qualified opps', total(scored, 'qualifiedOpps'), 'Attio'],
  ];
  const kpis = K.map(([l, v, s]) => tile(l, num(v), v === null ? 'not sourced yet' : s)).join('')
    + tile('Pipeline generated', num(total(scored, 'pipeline'), { money: true }),
      total(scored, 'pipeline') === null ? 'not sourced yet' : 'Attio');

  const campaignRows = live.length ? live.map((c) => `<tr>
    <td class="name"><a href="${esc(c.url)}">${esc(c.name)}</a>
      ${c.nextAction ? `<div class="cell-note">Next: ${esc(c.nextAction)}</div>` : ''}</td>
    <td>${esc(c.owner || '')}</td>
    <td class="n">${num(c.contactsReached)}</td>
    <td class="n">${num(c.positiveReplies)}</td>
    <td class="n">${num(c.meetingsBooked)}</td>
    <td>${c.reviewDate ? dueLabel(c.reviewDate) : `${BLANK} <span class="note">no review date</span>`}</td>
    <td>${c.lgmId ? '<span class="pill good">&#9679; linked</span>'
      : '<span class="pill warning">&#9724; no LGM id</span>'}</td>
  </tr>`).join('') : '';

  const decisionRows = decisions.map((d) => `<tr>
    <td class="name"><a href="${esc(d.url)}">${esc(d.title)}</a>
      ${d.context ? `<div class="cell-note">${esc(d.context.slice(0, 150))}${d.context.length > 150 ? '&hellip;' : ''}</div>` : ''}</td>
    <td>${esc(d.owner || 'Unassigned')}</td>
    <td>${esc(d.type || '')}</td>
    <td>${dueLabel(d.reviewDate)}</td>
  </tr>`).join('');

  const blockerRows = blockers.map((b) => `<tr>
    <td>${impactPill(b.impact)}</td>
    <td class="name"><a href="${esc(b.url)}">${esc(b.title)}</a>
      ${b.requestedAction ? `<div class="cell-note">${esc(b.requestedAction.slice(0, 140))}${b.requestedAction.length > 140 ? '&hellip;' : ''}</div>` : ''}</td>
    <td>${esc(b.owner || 'Unassigned')}${b.externalOwner ? `<div class="note">via ${esc(b.externalOwner)}</div>` : ''}</td>
    <td>${dueLabel(b.nextFollowUp)}</td>
  </tr>`).join('');

  const learningRows = learnings.map((l) => `<tr>
    <td class="name"><a href="${esc(l.url)}">${esc(l.title)}</a>
      ${l.implication ? `<div class="cell-note">${esc(l.implication.slice(0, 160))}${l.implication.length > 160 ? '&hellip;' : ''}</div>` : ''}</td>
    <td>${esc(l.confidence || '')}</td>
    <td>${esc(l.type || '')}</td>
    <td>${esc(l.status || '')}</td>
  </tr>`).join('');

  const overdue = decisions.filter((d) => (daysUntil(d.reviewDate) ?? 99) < 0).length;
  const critical = blockers.filter((b) => b.impact === 'Critical').length;

  const body = `
<header>
  <h1>GTM / Outbound Command Center</h1>
  <p class="sub">What we are trying, what is running, what it produced, what is in the way.</p>
  <div class="meta">
    <span>${campaigns.length} campaigns &middot; ${live.length} live</span>
    <span>${decisions.length} open decisions${overdue ? ` &middot; ${overdue} overdue` : ''}</span>
    <span>${blockers.length} active blockers${critical ? ` &middot; ${critical} critical` : ''}</span>
  </div>
</header>

<div class="banner">
  <b>Blank is not zero.</b> A dash means no source is wired for that metric yet &mdash; it is
  never a measured zero. ${anySynced
    ? 'Some campaigns are syncing from La Growth Machine.'
    : 'The La Growth Machine sync is <b>not connected</b>, so send and touch counts stay blank. '
      + 'The numbers that are present were entered by hand from the 17 Aug LGM audit.'}
</div>

<div class="kpis">${kpis}</div>

<section>
  <div class="shead"><h2>Running now</h2><span class="note">Status = Live</span></div>
  <div class="scroll">${live.length ? `<table>
    <thead><tr><th>Campaign</th><th>Owner</th><th class="n">Reached</th>
    <th class="n">Positive</th><th class="n">Meetings</th><th>Review</th><th>Sync</th></tr></thead>
    <tbody>${campaignRows}</tbody></table>`
    : '<div class="empty">No campaign is marked Live.</div>'}</div>
</section>

<section>
  <div class="shead"><h2>Decisions needed</h2><span class="note">Owner and review date, or it is an opinion</span></div>
  <div class="scroll">${decisions.length ? `<table>
    <thead><tr><th>Decision</th><th>Owner</th><th>Type</th><th>Review</th></tr></thead>
    <tbody>${decisionRows}</tbody></table>`
    : '<div class="empty">Nothing open.</div>'}</div>
</section>

<section>
  <div class="shead"><h2>Active blockers</h2><span class="note">Hardest first</span></div>
  <div class="scroll">${blockers.length ? `<table>
    <thead><tr><th>Impact</th><th>Blocker</th><th>Owner</th><th>Follow-up</th></tr></thead>
    <tbody>${blockerRows}</tbody></table>`
    : '<div class="empty">Nothing blocking.</div>'}</div>
</section>

<section>
  <div class="shead"><h2>Latest learnings</h2><span class="note">Evidence-backed only</span></div>
  <div class="scroll">${learnings.length ? `<table>
    <thead><tr><th>Learning</th><th>Confidence</th><th>Type</th><th>Status</th></tr></thead>
    <tbody>${learningRows}</tbody></table>`
    : '<div class="empty">Nothing captured yet.</div>'}</div>
</section>`;

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
  return res.status(200).send(page(body, new Date().toUTCString()));
}
