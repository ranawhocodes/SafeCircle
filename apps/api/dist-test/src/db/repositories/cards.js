import { one, pool, query } from '../pool.js';
function toCard(r) {
    return {
        key: r.key,
        version: r.version,
        title: r.title,
        group: r.card_group,
        body: r.body,
        source: r.source,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        reviewDue: r.review_due,
    };
}
/** Latest reviewed version of every card. */
export async function servableCards() {
    const rows = await query(`SELECT DISTINCT ON (key) *
     FROM cards
     WHERE reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
     ORDER BY key, version DESC`);
    return rows.map(toCard);
}
export async function findCard(key) {
    const row = await one(`SELECT * FROM cards
     WHERE key = $1 AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
     ORDER BY version DESC LIMIT 1`, [key]);
    return row ? toCard(row) : null;
}
export async function upsertCard(card, client = pool) {
    await client.query(`INSERT INTO cards (key, version, title, card_group, body, source, reviewed_by, reviewed_at, review_due)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (key, version) DO UPDATE
       SET title = $3, card_group = $4, body = $5, source = $6,
           reviewed_by = $7, reviewed_at = $8, review_due = $9`, [
        card.key, card.version, card.title, card.group, card.body, card.source,
        card.reviewedBy, card.reviewedAt, card.reviewDue,
    ]);
}
export async function recordCardSelection(incidentId, volunteerId, cardKey, client = pool) {
    // Every change is kept: FR-BRF-6 requires the history, not just the latest tap.
    await client.query(`UPDATE card_selections SET superseded_at = now()
     WHERE incident_id = $1 AND volunteer_id = $2 AND superseded_at IS NULL`, [incidentId, volunteerId]);
    await client.query('INSERT INTO card_selections (incident_id, volunteer_id, card_key) VALUES ($1,$2,$3)', [incidentId, volunteerId, cardKey]);
}
//# sourceMappingURL=cards.js.map