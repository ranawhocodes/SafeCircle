/**
 * Demo seed.
 *
 * Builds the two personas from the decision log - Lakshmi, 78 (the worked example
 * in section 14.2) and Arjun, 9 (non-verbal autistic child with a Go pendant) -
 * plus Meera using Stealth mode, a society with guards, and a spread of
 * volunteers that exercises every tiering rule.
 *
 * Coordinates are around Besant Nagar, Chennai. Phone numbers are in the
 * reserved +91 99999 range so nothing can dial a real person.
 */
import { coarseCell } from '@safecircle/shared';
import { pool, closePool } from '../db/pool.js';
import { createDevice } from '../db/repositories/devices.js';
import { setAccessSecrets, updateHealthAndHandling } from '../db/repositories/people.js';
import { upsertCard } from '../db/repositories/cards.js';
import { SEED_CARDS } from './cards.js';
import { offlineGeolocation } from '../providers/index.js';
const SOCIETY = { id: 'soc_besant', name: 'Besant Nagar Residents Welfare Association', lat: 13.0002, lng: 80.2668 };
/** Device HMAC keys are demo-only and printed at the end so the simulator can sign. */
export const DEMO_DEVICE_KEYS = {
    'HB-001': 'demo-key-home-lakshmi-bedroom',
    'HB-002': 'demo-key-home-lakshmi-bathroom',
    'GO-021': 'demo-key-go-lakshmi',
    'GO-042': 'demo-key-go-arjun',
    'GO-077': 'demo-key-go-meera',
    // Seeded but deliberately left unclaimed, so the portal's claim flow and the
    // "an unclaimed device cannot raise an alarm" rule can both be exercised.
    'HB-003': 'demo-key-spare',
};
/** Seeded Wi-Fi networks, so the "indoors, no GPS" scene resolves offline. */
const WIFI_SEEDS = [
    { bssid: 'a4:2b:b0:11:22:33', lat: 13.0002, lng: 80.2668, accuracyM: 45 },
    { bssid: 'f0:9f:c2:44:55:66', lat: 13.0015, lng: 80.2672, accuracyM: 60 },
    { bssid: 'de:ad:be:ef:00:01', lat: 13.0101, lng: 80.2601, accuracyM: 55 },
];
async function reset() {
    await pool.query(`
    TRUNCATE outbox, audit_log, card_selections, verifications, dispatches,
             incident_timers, person_locations, incident_events, incidents,
             volunteer_fixes, volunteer_zones, vouches, volunteer_duty_windows,
             volunteer_skills, volunteers, known_places, device_status_cursor,
             devices, consents, family_contacts, sender_numbers, caregiver_links,
             caregivers, person_access_secrets, people, guards, societies,
             sessions, otp_codes
    CASCADE`);
}
export async function seed(opts = {}) {
    const log = (msg) => {
        if (!opts.quiet)
            console.log(msg);
    };
    await reset();
    for (const c of SEED_CARDS)
        await upsertCard(c);
    log(`seeded ${SEED_CARDS.length} doctor-review-gated flashcards`);
    for (const w of WIFI_SEEDS)
        offlineGeolocation.seed(w.bssid, w.lat, w.lng, w.accuracyM);
    // --- society and guards --------------------------------------------------
    await pool.query('INSERT INTO societies (id, name, lat, lng) VALUES ($1,$2,$3,$4)', [
        SOCIETY.id, SOCIETY.name, SOCIETY.lat, SOCIETY.lng,
    ]);
    await pool.query(`INSERT INTO guards (id, society_id, name, phone, on_duty, desk_token, order_index)
     VALUES ('grd_ravi',$1,'Ravi (day shift)','+919999900001',true,'desk-token-demo',0),
            ('grd_suresh',$1,'Suresh (night shift)','+919999900002',false,NULL,1)`, [SOCIETY.id]);
    // --- caregiver -----------------------------------------------------------
    await pool.query(`INSERT INTO caregivers (id, phone, name, verified_at)
     VALUES ('cg_priya','+919999900010','Priya Raman', now())`);
    // --- Lakshmi, 78: the worked example in section 14.2 ---------------------
    await pool.query(`INSERT INTO people
       (id, name, responds_to_name, age_band, languages, society_id, address, flat,
        landmark, lat, lng, feedback_profile, protected, has_own_phone, own_phone,
        responder_preference)
     VALUES ('per_lakshmi','Lakshmi Raman','Paati','75+','{ta,en}',$1,
             '12 Gandhi Street, Besant Nagar','B-204','Opposite the temple tank',
             13.0002, 80.2668,'loud', false, true,'+919999900011', NULL)`, [SOCIETY.id]);
    await updateHealthAndHandling('per_lakshmi', {
        conditions: ['Type 2 diabetes', 'Hypertension'],
        medicines: ['Metformin', 'Amlodipine'],
        allergies: ['Penicillin'],
        bloodGroup: 'B+',
        mobilityAids: ['Walking stick'],
        doctor: 'Dr Anand, Adyar Clinic',
        hospital: 'Government Hospital, Adyar',
    }, {
        hearing: 'Hard of hearing: face her and speak slowly.',
        calmingSteps: ['Use her name, Paati. Tell her help is coming.'],
    });
    await setAccessSecrets('per_lakshmi', {
        gateCode: '4821',
        spareKeyHolder: 'Neighbour in B-205',
    });
    await pool.query(`INSERT INTO caregiver_links (caregiver_id, person_id, role, can_cancel, is_primary)
     VALUES ('cg_priya','per_lakshmi','daughter', true, true)`);
    await pool.query(`INSERT INTO sender_numbers (phone, person_id, role, confirmed_at, can_cancel, never_inform)
     VALUES ('+919999900011','per_lakshmi','self', now(), true, false),
            ('+919999900010','per_lakshmi','caregiver', now(), true, false)`);
    await pool.query(`INSERT INTO family_contacts (person_id, order_index, name, phone, relation, never_inform)
     VALUES ('per_lakshmi',0,'Priya (daughter)','+919999900010','daughter', false),
            ('per_lakshmi',1,'Karthik (son)','+919999900012','son', false)`);
    await pool.query(`INSERT INTO consents (person_id, granted_by, capacity_basis, scope)
     VALUES ('per_lakshmi','Lakshmi Raman','self','{profile,location_during_alerts,health_to_responders}')`);
    // --- Arjun, 9: non-verbal autistic child with a Go pendant --------------
    await pool.query(`INSERT INTO people
       (id, name, responds_to_name, age_band, languages, society_id, address, flat,
        lat, lng, feedback_profile, protected, wandering_history, has_own_phone)
     VALUES ('per_arjun','Arjun Kumar','Arju','0-12','{ta}',$1,
             '12 Gandhi Street, Besant Nagar','C-101', 13.0005, 80.2670,'calm', true, true, false)`, [SOCIETY.id]);
    await updateHealthAndHandling('per_arjun', { conditions: ['Autism spectrum'], allergies: ['Peanuts'], bloodGroup: 'O+' }, {
        speech: 'Non-verbal. He will not answer questions.',
        avoid: ['Do not touch him', 'No loud voices', 'Do not crowd him'],
        calmingSteps: ['Lower your voice. Give him space. Show, do not tell.'],
    });
    await pool.query(`INSERT INTO caregiver_links (caregiver_id, person_id, role, can_cancel, is_primary)
     VALUES ('cg_priya','per_arjun','aunt', true, false)`);
    await pool.query(`INSERT INTO sender_numbers (phone, person_id, role, confirmed_at, can_cancel, never_inform)
     VALUES ('+919999900010','per_arjun','caregiver', now(), true, false)`);
    await pool.query(`INSERT INTO family_contacts (person_id, order_index, name, phone, relation, never_inform)
     VALUES ('per_arjun',0,'Priya (aunt)','+919999900010','aunt', false)`);
    // DPDP Rule 10: a child's data needs verifiable parental consent.
    await pool.query(`INSERT INTO consents (person_id, granted_by, capacity_basis, scope)
     VALUES ('per_arjun','Priya Raman','parent','{profile,location_during_alerts,health_to_responders}')`);
    await pool.query(`INSERT INTO known_places (person_id, label, wifi_bssids, lat, lng, radius_m)
     VALUES ('per_arjun','Hillside Special School','{de:ad:be:ef:00:01}', 13.0101, 80.2601, 60)`);
    // --- Meera: Stealth mode in public (section 7.2) ------------------------
    await pool.query(`INSERT INTO people
       (id, name, age_band, languages, society_id, lat, lng, feedback_profile,
        protected, has_own_phone, own_phone, responder_preference,
        safe_pin_hash, duress_pin_hash)
     VALUES ('per_meera','Meera S','18-59','{ta,en,hi}',$1, 13.0020, 80.2680,'stealth',
             true, true,'+919999900013','woman_first','hash_1234','hash_9999')`, [SOCIETY.id]);
    await updateHealthAndHandling('per_meera', {}, {});
    await pool.query(`INSERT INTO caregiver_links (caregiver_id, person_id, role, can_cancel, is_primary)
     VALUES ('cg_priya','per_meera','friend', false, true)`);
    await pool.query(`INSERT INTO sender_numbers (phone, person_id, role, confirmed_at, can_cancel, never_inform)
     VALUES ('+919999900013','per_meera','self', now(), true, false)`);
    await pool.query(`INSERT INTO family_contacts (person_id, order_index, name, phone, relation, never_inform)
     VALUES ('per_meera',0,'Divya (sister)','+919999900014','sister', false),
            ('per_meera',1,'Ex-partner - DO NOT INFORM','+919999900015','ex_partner', true)`);
    await pool.query(`INSERT INTO consents (person_id, granted_by, capacity_basis, scope)
     VALUES ('per_meera','Meera S','self','{profile,location_during_alerts}')`);
    // --- devices -------------------------------------------------------------
    const devices = [
        ['HB-001', 'home', 'per_lakshmi'],
        ['HB-002', 'home', 'per_lakshmi'],
        ['GO-021', 'go', 'per_lakshmi'],
        ['GO-042', 'go', 'per_arjun'],
        ['GO-077', 'go', 'per_meera'],
    ];
    for (const [deviceId, type, personId] of devices) {
        await createDevice(deviceId, type, DEMO_DEVICE_KEYS[deviceId], `CLAIM-${deviceId}`);
        if (personId) {
            await pool.query(`UPDATE devices SET person_id = $2, claimed_at = now(), claim_code = NULL,
                            status = 'active', battery_pct = 82, last_seen_at = now()
         WHERE device_id = $1`, [deviceId, personId]);
        }
    }
    // One unclaimed spare, so the portal's claim flow can be demonstrated.
    await createDevice('HB-003', 'home', DEMO_DEVICE_KEYS['HB-003'], 'CLAIM-HB-003');
    // --- volunteers ----------------------------------------------------------
    // A spread that exercises every rule: verified vs not, skills, distance,
    // opt-outs, the daily cap, and an expired certificate.
    const volunteers = [
        { id: 'vol_priya_n', name: 'Priya N', phone: '+919999900101', trust: 3, skills: [['nurse', null]], lat: 13.0025, lng: 80.2672, transport: 'walk', isWoman: true, languages: ['ta', 'en'], reliability: 0.9, optOut: [], tutorial: true, availability: 'available_now' },
        { id: 'vol_arun', name: 'Arun M', phone: '+919999900102', trust: 2, skills: [['first_aider', new Date('2027-06-01')]], lat: 13.0008, lng: 80.2660, transport: 'two_wheeler', isWoman: false, languages: ['ta'], reliability: 0.7, optOut: [], tutorial: true, availability: 'available_now' },
        { id: 'vol_deepa', name: 'Deepa R', phone: '+919999900103', trust: 2, skills: [['doctor', null]], lat: 13.0040, lng: 80.2690, transport: 'walk', isWoman: true, languages: ['ta', 'en', 'hi'], reliability: 0.85, optOut: [], tutorial: true, availability: 'available_now' },
        { id: 'vol_karthik', name: 'Karthik S', phone: '+919999900104', trust: 2, skills: [], lat: 13.0060, lng: 80.2700, transport: 'walk', isWoman: false, languages: ['ta'], reliability: 0.5, optOut: ['harassment'], tutorial: true, availability: 'available_now' },
        { id: 'vol_sanjay', name: 'Sanjay K', phone: '+919999900105', trust: 0, skills: [], lat: 13.0003, lng: 80.2665, transport: 'walk', isWoman: false, languages: ['ta'], reliability: 0.4, optOut: [], tutorial: true, availability: 'available_now' },
        { id: 'vol_fatima', name: 'Fatima A', phone: '+919999900106', trust: 1, skills: [], lat: 13.0010, lng: 80.2675, transport: 'cycle', isWoman: true, languages: ['ta', 'en'], reliability: 0.6, optOut: [], tutorial: true, availability: 'available_now' },
        // An expired first-aid certificate: the badge and its ranking bonus lapse.
        { id: 'vol_rahul', name: 'Rahul V', phone: '+919999900107', trust: 2, skills: [['first_aider', new Date('2025-01-01')]], lat: 13.0030, lng: 80.2680, transport: 'walk', isWoman: false, languages: ['ta'], reliability: 0.65, optOut: [], tutorial: true, availability: 'available_now' },
        // Has not finished the tutorial: cannot go available at all.
        { id: 'vol_new', name: 'Nithya P (new)', phone: '+919999900108', trust: 1, skills: [], lat: 13.0012, lng: 80.2669, transport: 'walk', isWoman: true, languages: ['ta'], reliability: 0.5, optOut: [], tutorial: false, availability: 'off' },
        // Far away: outside every radius step, to prove widening has a limit.
        { id: 'vol_far', name: 'Mohan T (far)', phone: '+919999900109', trust: 2, skills: [['paramedic', null]], lat: 13.0900, lng: 80.3500, transport: 'two_wheeler', isWoman: false, languages: ['ta'], reliability: 0.8, optOut: [], tutorial: true, availability: 'available_now' },
    ];
    for (const v of volunteers) {
        await pool.query(`INSERT INTO volunteers
         (id, name, phone, trust_level, languages, is_woman, home_lat, home_lng,
          society_id, transport, max_distance_m, opted_out_case_types,
          reliability_score, availability_mode, tutorial_completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [
            v.id, v.name, v.phone, v.trust, v.languages, v.isWoman, v.lat, v.lng,
            SOCIETY.id, v.transport, 5000, v.optOut, v.reliability, v.availability,
            v.tutorial ? new Date() : null,
        ]);
        for (const [skill, expires] of v.skills) {
            await pool.query(`INSERT INTO volunteer_skills (volunteer_id, skill, verified_at, expires_at)
         VALUES ($1,$2, now(), $3)`, [v.id, skill, expires]);
        }
        const cell = coarseCell(v.lat, v.lng);
        await pool.query(`INSERT INTO volunteer_zones (volunteer_id, cell_lat, cell_lng, updated_at)
       VALUES ($1,$2,$3, now())`, [v.id, cell.cellLat, cell.cellLng]);
    }
    // Her own history: 4 of her last 6 incidents were falls, which is what makes
    // the flashcard prediction in section 14.2 come out as Fall, Low blood sugar,
    // Stroke. Seeded last, because it references a volunteer.
    await seedHistory('per_lakshmi', [
        'fall_older_person',
        'fall_older_person',
        'low_blood_sugar',
        'fall_older_person',
    ]);
    log(`seeded 1 society, 2 guards, 3 people, ${devices.length + 1} devices, ${volunteers.length} volunteers`);
    log('');
    log('Demo sign-in numbers (OTP is returned by the API outside production):');
    log('  caregiver  +919999900010  (Priya - manages Lakshmi, Arjun, Meera)');
    log('  volunteer  +919999900101  (Priya N, Verified, Nurse)');
    log('  volunteer  +919999900102  (Arun M, Verified, First-aider)');
    log('  guard      +919999900001  (Ravi, on duty)');
    log('');
    log('Device keys for the simulator:');
    for (const [id, key] of Object.entries(DEMO_DEVICE_KEYS))
        log(`  ${id}  ${key}`);
}
/**
 * Give a person a believable incident history, so the flashcard predictor has
 * something to learn from. These are closed incidents with a card selection.
 */
async function seedHistory(personId, cardKeys) {
    let i = 0;
    for (const cardKey of cardKeys) {
        const id = `inc_seed_${personId}_${i}`;
        const daysAgo = (cardKeys.length - i) * 30;
        await pool.query(`INSERT INTO incidents (id, person_id, source, severity, case_type, state,
                              opened_at, closed_at, outcome, last_event_at)
       VALUES ($1,$2,'home_button','P2','fall','resolved',
               now() - ($3 || ' days')::interval,
               now() - ($3 || ' days')::interval + interval '20 minutes',
               'helped_on_scene',
               now() - ($3 || ' days')::interval)`, [id, personId, daysAgo]);
        await pool.query(`INSERT INTO card_selections (incident_id, volunteer_id, card_key, at)
       VALUES ($1,'vol_priya_n',$2, now() - ($3 || ' days')::interval)`, [id, cardKey, daysAgo]);
        i += 1;
    }
}
const invokedDirectly = process.argv[1]?.endsWith('seed.js') === true;
if (invokedDirectly) {
    seed()
        .then(closePool)
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=seed.js.map