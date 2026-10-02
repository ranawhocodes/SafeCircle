/** People, their circle, and the encrypted parts of their profile. */
import type { AgeBand, FeedbackProfile, HandlingNeeds, HealthSummary, PersonProfile } from '@safecircle/shared';
import { decryptJson, encryptJson } from '../../security/crypto.js';
import { one, pool, query, type Queryable } from '../pool.js';

interface PersonRow {
  id: string;
  name: string;
  responds_to_name: string | null;
  photo_url: string | null;
  age_band: AgeBand;
  languages: string[];
  society_id: string | null;
  address: string | null;
  flat: string | null;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  feedback_profile: FeedbackProfile;
  pre_send_countdown_s: number;
  enc_health: Buffer | null;
  enc_handling: Buffer | null;
  protected: boolean;
  wandering_history: boolean;
  responder_preference: 'woman_first' | null;
  has_own_phone: boolean;
  own_phone: string | null;
  safe_pin_hash: string | null;
  duress_pin_hash: string | null;
}

function toProfile(row: PersonRow): PersonProfile {
  return {
    id: row.id,
    name: row.name,
    respondsToName: row.responds_to_name ?? undefined,
    ageBand: row.age_band,
    languages: row.languages,
    photoUrl: row.photo_url ?? undefined,
    societyId: row.society_id ?? undefined,
    address: row.address ?? undefined,
    flat: row.flat ?? undefined,
    landmark: row.landmark ?? undefined,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    feedbackProfile: row.feedback_profile,
    preSendCountdownS: row.pre_send_countdown_s,
    health: decryptJson<HealthSummary>(row.enc_health),
    handling: decryptJson<HandlingNeeds>(row.enc_handling),
    protected: row.protected,
    wanderingHistory: row.wandering_history,
    responderPreference: row.responder_preference,
    hasOwnPhone: row.has_own_phone,
    safePinSet: row.safe_pin_hash !== null,
    duressPinSet: row.duress_pin_hash !== null,
  };
}

export async function findPerson(id: string): Promise<PersonProfile | null> {
  const row = await one<PersonRow>(
    'SELECT * FROM people WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return row ? toProfile(row) : null;
}

export async function findPersonOwnPhone(id: string): Promise<string | null> {
  const row = await one<{ own_phone: string | null }>(
    'SELECT own_phone FROM people WHERE id = $1',
    [id],
  );
  return row?.own_phone ?? null;
}

/**
 * Resolve a phone number to the person it may raise an alarm for (FR-TRG-5/7).
 * An unconfirmed number does not route, so adding a number cannot by itself
 * grant someone the power to raise alarms.
 */
export async function findPersonBySenderNumber(
  phone: string,
): Promise<{ person: PersonProfile; role: 'self' | 'caregiver'; canCancel: boolean } | null> {
  const row = await one<{ person_id: string; role: 'self' | 'caregiver'; can_cancel: boolean }>(
    `SELECT person_id, role, can_cancel FROM sender_numbers
     WHERE phone = $1 AND confirmed_at IS NOT NULL
     ORDER BY role = 'self' DESC
     LIMIT 1`,
    [phone],
  );
  if (!row) return null;
  const person = await findPerson(row.person_id);
  if (!person) return null;
  return { person, role: row.role, canCancel: row.can_cancel };
}

/** All dependents a caregiver number covers, for the "HELP Lakshmi" disambiguation. */
export async function findDependentsForNumber(phone: string): Promise<PersonProfile[]> {
  const rows = await query<PersonRow>(
    `SELECT p.* FROM people p
     JOIN sender_numbers s ON s.person_id = p.id
     WHERE s.phone = $1 AND s.confirmed_at IS NOT NULL AND p.deleted_at IS NULL
     ORDER BY p.name`,
    [phone],
  );
  return rows.map(toProfile);
}

export interface AccessSecrets {
  gateCode?: string;
  doorCode?: string;
  spareKeyHolder?: string;
}

/** Guard-only, encrypted, and every release is audited by the caller. */
export async function findAccessSecrets(personId: string): Promise<AccessSecrets> {
  const row = await one<{ enc_payload: Buffer }>(
    'SELECT enc_payload FROM person_access_secrets WHERE person_id = $1',
    [personId],
  );
  return decryptJson<AccessSecrets>(row?.enc_payload ?? null) ?? {};
}

export async function setAccessSecrets(
  personId: string,
  secrets: AccessSecrets,
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO person_access_secrets (person_id, enc_payload, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (person_id) DO UPDATE SET enc_payload = $2, updated_at = now()`,
    [personId, encryptJson(secrets)],
  );
}

export interface FamilyContact {
  id: number;
  orderIndex: number;
  name: string | null;
  phone: string;
  relation: string | null;
  neverInform: boolean;
}

/**
 * The ordered escalation chain. `neverInform` contacts are returned so the
 * caller can see they exist, but `informableFamilyContacts` is what the
 * notification service uses (FR-FAM-4).
 */
export async function findFamilyContacts(personId: string): Promise<FamilyContact[]> {
  const rows = await query<{
    id: number; order_index: number; name: string | null;
    phone: string; relation: string | null; never_inform: boolean;
  }>(
    'SELECT * FROM family_contacts WHERE person_id = $1 ORDER BY order_index',
    [personId],
  );
  return rows.map((r) => ({
    id: r.id,
    orderIndex: r.order_index,
    name: r.name,
    phone: r.phone,
    relation: r.relation,
    neverInform: r.never_inform,
  }));
}

/**
 * Section 16.3 #14: in a domestic-violence case the abuser may be a registered
 * family contact. This filter is the only way the notification service reaches
 * family, so the rule cannot be bypassed by a careless caller.
 */
export async function informableFamilyContacts(personId: string): Promise<FamilyContact[]> {
  const all = await findFamilyContacts(personId);
  return all.filter((c) => !c.neverInform);
}

export interface KnownPlace {
  label: string;
  bssids: string[];
  lat: number;
  lng: number;
  radiusM: number;
}

export async function findKnownPlaces(personId: string): Promise<KnownPlace[]> {
  const rows = await query<{
    label: string; wifi_bssids: string[]; lat: number; lng: number; radius_m: number;
  }>('SELECT * FROM known_places WHERE person_id = $1', [personId]);
  return rows.map((r) => ({
    label: r.label,
    bssids: r.wifi_bssids,
    lat: r.lat,
    lng: r.lng,
    radiusM: r.radius_m,
  }));
}

/**
 * Match a Wi-Fi scan against the person's saved networks. One seen BSSID is
 * enough: the pendant is in that building (FR-SET-11).
 */
export async function matchKnownPlace(
  personId: string,
  seen: Array<{ bssid: string }>,
): Promise<KnownPlace | null> {
  if (seen.length === 0) return null;
  const places = await findKnownPlaces(personId);
  const seenSet = new Set(seen.map((s) => s.bssid.toLowerCase()));
  return (
    places.find((p) => p.bssids.some((b) => seenSet.has(b.toLowerCase()))) ?? null
  );
}

/** Outcome card keys from this person's closed incidents, newest first. */
export async function findIncidentHistory(personId: string, limit = 6): Promise<string[]> {
  const rows = await query<{ card_key: string }>(
    `SELECT cs.card_key
     FROM card_selections cs
     JOIN incidents i ON i.id = cs.incident_id
     WHERE i.person_id = $1 AND i.closed_at IS NOT NULL AND cs.superseded_at IS NULL
     ORDER BY cs.at DESC
     LIMIT $2`,
    [personId, limit],
  );
  return rows.map((r) => r.card_key);
}

export async function updateHealthAndHandling(
  personId: string,
  health: HealthSummary | null,
  handling: HandlingNeeds | null,
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    'UPDATE people SET enc_health = $2, enc_handling = $3 WHERE id = $1',
    [personId, encryptJson(health), encryptJson(handling)],
  );
}
