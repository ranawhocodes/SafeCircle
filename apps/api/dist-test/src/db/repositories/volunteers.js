import { randomBytes } from 'node:crypto';
import { coarseCell, evaluateVouchOutcome } from '@safecircle/shared';
import { one, pool, query } from '../pool.js';
export async function findVolunteer(id) {
    const row = await one(`SELECT v.*, ARRAY(
       SELECT s.skill FROM volunteer_skills s
       WHERE s.volunteer_id = v.id AND (s.expires_at IS NULL OR s.expires_at > now())
     ) AS skills
     FROM volunteers v WHERE v.id = $1 AND v.deleted_at IS NULL`, [id]);
    if (!row)
        return null;
    return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        trustLevel: row.trust_level,
        skills: row.skills,
        languages: row.languages,
        availabilityMode: row.availability_mode,
        availableUntil: row.available_until,
        tutorialCompletedAt: row.tutorial_completed_at,
        suspendedAt: row.suspended_at,
        societyId: row.society_id,
        homeLat: row.home_lat,
        homeLng: row.home_lng,
        reliabilityScore: row.reliability_score,
        isWoman: row.is_woman,
        asPersonId: row.as_person_id ?? null,
    };
}
/**
 * Ensure a volunteer has a corresponding person row so the engine can treat them
 * as the subject of an emergency when they raise an SOS (F23).
 */
export async function ensurePersonForVolunteer(v) {
    if (v.asPersonId)
        return v.asPersonId;
    const personId = `per_${v.id}`;
    await pool.query(`INSERT INTO people (
       id, name, age_band, languages, society_id, lat, lng, own_phone, has_own_phone, feedback_profile
     ) VALUES ($1, $2, '18-59', $3, $4, $5, $6, $7, true, 'standard')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, [personId, v.name, v.languages, v.societyId, v.homeLat, v.homeLng, v.phone]);
    try {
        await pool.query('UPDATE volunteers SET as_person_id = $2 WHERE id = $1', [v.id, personId]);
    }
    catch {
        /* ignore */
    }
    return personId;
}
/**
 * FR-VOL-8: a volunteer cannot go available until the mandatory tutorial and
 * practice alert are finished. Enforced here rather than in the app, so an
 * unmodified API client cannot bypass it.
 */
export async function setAvailability(volunteerId, mode, until) {
    const v = await findVolunteer(volunteerId);
    if (!v)
        return 'not_found';
    if (v.suspendedAt)
        return 'suspended';
    if (mode !== 'off' && !v.tutorialCompletedAt)
        return 'tutorial_required';
    await pool.query('UPDATE volunteers SET availability_mode = $2, available_until = $3 WHERE id = $1', [volunteerId, mode, until]);
    return 'ok';
}
/**
 * Store a volunteer's coarse zone. This is an UPDATE, never an INSERT: between
 * incidents SafeCircle keeps one ~1 km cell and no movement history at all
 * (section 11.4).
 */
export async function updateZone(volunteerId, lat, lng) {
    const cell = coarseCell(lat, lng);
    await pool.query(`INSERT INTO volunteer_zones (volunteer_id, cell_lat, cell_lng, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (volunteer_id) DO UPDATE
       SET cell_lat = $2, cell_lng = $3, updated_at = now()`, [volunteerId, cell.cellLat, cell.cellLng]);
}
/** A precise fix, valid only inside an incident and purged 72 h after close. */
export async function insertFix(volunteerId, incidentId, lat, lng, accuracyM) {
    await pool.query(`INSERT INTO volunteer_fixes (volunteer_id, incident_id, lat, lng, accuracy_m)
     VALUES ($1,$2,$3,$4,$5)`, [volunteerId, incidentId, lat, lng, accuracyM]);
}
export async function latestFix(volunteerId, incidentId) {
    const row = await one(`SELECT lat, lng, accuracy_m, at FROM volunteer_fixes
     WHERE volunteer_id = $1 AND incident_id = $2 ORDER BY at DESC LIMIT 1`, [volunteerId, incidentId]);
    return row ? { lat: row.lat, lng: row.lng, accuracyM: row.accuracy_m, at: row.at } : null;
}
export async function completeTutorial(volunteerId) {
    await pool.query('UPDATE volunteers SET tutorial_completed_at = COALESCE(tutorial_completed_at, now()) WHERE id = $1', [volunteerId]);
}
export async function setTrustLevel(volunteerId, level, client = pool) {
    await client.query('UPDATE volunteers SET trust_level = $2 WHERE id = $1', [volunteerId, level]);
}
/** Badge wording for the family status page and the 112 packet. */
export function badgeFor(trustLevel) {
    switch (trustLevel) {
        case 0: return 'Registered';
        case 1: return 'ID checked';
        case 2: return 'Verified';
        case 3: return 'Verified professional';
        case 4: return 'Police verified';
    }
}
const SKILL_LABELS = {
    doctor: 'Doctor',
    nurse: 'Nurse',
    paramedic: 'Paramedic',
    first_aider: 'First-aider',
    police: 'Police',
    fire: 'Fire service',
};
/** The single skill worth showing a frightened family, or null. */
export function primarySkillLabel(skills) {
    for (const s of ['doctor', 'nurse', 'paramedic', 'first_aider', 'police', 'fire']) {
        if (skills.includes(s))
            return SKILL_LABELS[s] ?? null;
    }
    return null;
}
/** Nudge the reliability score after an incident closes (FR-ALT-5 input). */
export async function adjustReliability(volunteerId, delta) {
    await pool.query(`UPDATE volunteers
     SET reliability_score = LEAST(1, GREATEST(0, reliability_score + $2))
     WHERE id = $1`, [volunteerId, delta]);
}
export async function recordVouch(candidateId, voterId, choice, encReason) {
    await pool.query(`INSERT INTO vouches (candidate_id, voter_id, choice, enc_private_reason)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (candidate_id, voter_id) DO UPDATE
       SET choice = $3, enc_private_reason = $4, at = now()`, [candidateId, voterId, choice, encReason]);
}
export async function tallyVouches(candidateId) {
    const rows = await query('SELECT choice, count(*)::int AS n FROM vouches WHERE candidate_id = $1 GROUP BY choice', [candidateId]);
    const out = { vouch: 0, concern: 0, abstain: 0 };
    for (const r of rows) {
        if (r.choice === 'vouch')
            out.vouch = r.n;
        else if (r.choice === 'concern')
            out.concern = r.n;
        else
            out.abstain = r.n;
    }
    return out;
}
export async function getTutorialProgress(volunteerId) {
    const rows = await query('SELECT module_id, score FROM volunteer_module_progress WHERE volunteer_id = $1', [volunteerId]);
    const completedModules = rows.map((r) => r.module_id);
    const scores = {};
    for (const r of rows) {
        if (r.score !== null)
            scores[r.module_id] = r.score;
    }
    const v = await findVolunteer(volunteerId);
    return {
        completedModules,
        scores,
        isComplete: v?.tutorialCompletedAt !== null,
    };
}
export async function saveModuleProgress(volunteerId, moduleId, score) {
    await pool.query(`INSERT INTO volunteer_module_progress (volunteer_id, module_id, score, completed_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (volunteer_id, module_id) DO UPDATE
       SET score = COALESCE($3, volunteer_module_progress.score), completed_at = now()`, [volunteerId, moduleId, score ?? null]);
    const progress = await getTutorialProgress(volunteerId);
    const required = ['m1_safety', 'm2_speed', 'm3_scene', 'm4_privacy', 'm5_quiz', 'm6_drill'];
    const allDone = required.every((m) => progress.completedModules.includes(m));
    if (allDone) {
        await completeTutorial(volunteerId);
    }
    return { allDone };
}
export async function createVoteRound(candidateId, societyId, deadlineDays = 7) {
    const id = `round-${randomBytes(6).toString('hex')}`;
    const deadline = new Date(Date.now() + deadlineDays * 24 * 3600 * 1000);
    await pool.query(`INSERT INTO vote_rounds (id, candidate_id, society_id, status, opened_at, deadline_at)
     VALUES ($1, $2, $3, 'open', now(), $4)`, [id, candidateId, societyId, deadline]);
    return id;
}
export async function findOpenVoteRoundsForVoter(voterId) {
    const rows = await query(`SELECT vr.id, vr.candidate_id, v.name AS candidate_name, vr.society_id, vr.status, vr.opened_at, vr.deadline_at
     FROM vote_rounds vr
     JOIN volunteers v ON v.id = vr.candidate_id
     WHERE vr.status = 'open'
       AND vr.candidate_id != $1
       AND vr.id NOT IN (SELECT round_id FROM vouches WHERE voter_id = $1 AND round_id IS NOT NULL)
     ORDER BY vr.opened_at DESC`, [voterId]);
    const out = [];
    for (const r of rows) {
        const tally = await tallyRoundVouches(r.id);
        out.push({
            id: r.id,
            candidateId: r.candidate_id,
            candidateName: r.candidate_name,
            societyId: r.society_id,
            status: r.status,
            openedAt: r.opened_at,
            deadlineAt: r.deadline_at,
            vouchCount: tally.vouch,
            concernCount: tally.concern,
        });
    }
    return out;
}
export async function tallyRoundVouches(roundId) {
    const rows = await query('SELECT choice, at FROM vouches WHERE round_id = $1', [roundId]);
    let vouch = 0;
    let concern = 0;
    let abstain = 0;
    const entries = [];
    for (const r of rows) {
        if (r.choice === 'vouch')
            vouch++;
        else if (r.choice === 'concern')
            concern++;
        else
            abstain++;
        entries.push({ choice: r.choice, createdAt: r.at });
    }
    return { vouch, concern, abstain, entries };
}
export async function castRoundVote(roundId, voterId, choice, encReason = null) {
    const round = await one('SELECT id, candidate_id, society_id, status, opened_at, deadline_at FROM vote_rounds WHERE id = $1', [roundId]);
    if (!round)
        throw new Error('Round not found');
    await pool.query(`INSERT INTO vouches (round_id, candidate_id, voter_id, choice, enc_private_reason, at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (candidate_id, voter_id) DO UPDATE
       SET round_id = $1, choice = $4, enc_private_reason = $5, at = now()`, [roundId, round.candidate_id, voterId, choice, encReason]);
    const tally = await tallyRoundVouches(roundId);
    const evaluation = evaluateVouchOutcome(tally.entries, round.opened_at, new Date());
    if (evaluation.status !== 'open') {
        await pool.query('UPDATE vote_rounds SET status = $2, resolved_at = now() WHERE id = $1', [roundId, evaluation.status]);
        if (evaluation.status === 'passed') {
            await setTrustLevel(round.candidate_id, 2);
        }
    }
    return { status: evaluation.status, outcomeReason: evaluation.reason };
}
//# sourceMappingURL=volunteers.js.map