/**
 * Fan-out to volunteers, guards and family.
 *
 * The `never_inform` rule (FR-FAM-4) is enforced here, in the only code path
 * that reaches family. Section 16.3 #14 is a domestic-violence case where the
 * abuser is a registered contact, so no UI is trusted with that filter.
 */
import type { PreAcceptView, Tier } from '@safecircle/shared';
import { guardsForSociety, onDutyGuardsAnywhere } from '../db/repositories/geo.js';
import { informableFamilyContacts } from '../db/repositories/people.js';
import { appendEvent } from '../db/repositories/incidents.js';
import { providers } from '../providers/index.js';

export async function alertVolunteer(
  incidentId: string,
  volunteerId: string,
  tier: Tier,
  view: PreAcceptView,
): Promise<boolean> {
  const res = await providers.push.send({
    volunteerId,
    priority: tier === 1 ? 'high' : 'normal',
    kind: 'alert',
    payload: { incidentId, tier, alert: view },
  });
  return res.delivered;
}

export async function upgradeVolunteer(
  incidentId: string,
  volunteerId: string,
  view: PreAcceptView,
): Promise<void> {
  await providers.push.send({
    volunteerId,
    priority: 'high',
    kind: 'upgrade',
    payload: {
      incidentId,
      tier: 1,
      alert: { ...view, tier: 1 },
      headline: 'Urgent: nearest helpers have not responded.',
    },
  });
}

/** "Covered, thank you, stay available" once the case has its responders. */
export async function standDownVolunteer(
  incidentId: string,
  volunteerId: string,
  reason: 'covered' | 'stand_down',
): Promise<void> {
  await providers.push.send({
    volunteerId,
    priority: 'normal',
    kind: reason === 'covered' ? 'covered' : 'stand_down',
    payload: {
      incidentId,
      message:
        reason === 'covered'
          ? 'Covered, thank you. Stay available.'
          : 'Stand down: the person has been confirmed safe.',
    },
  });
}

export interface GuardAlert {
  incidentId: string;
  caseType: string;
  severity: string;
  flat: string | null;
  address: string | null;
  isDrill: boolean;
}

/**
 * Guards are often the fastest responder, and they are a trusted on-site role,
 * so they get the flat number immediately (section 15.2). An unreachable guard
 * escalates to the next, then the society admin, while timers keep running.
 */
export async function alertGuards(societyId: string | null, alert: GuardAlert): Promise<number> {
  // An unverified incident has no person and so no society. It must still reach
  // a staffed desk (FR-TRG-6), so fall back to every on-duty guard. The payload
  // carries no personal data, because there is no identified person to leak.
  const guards = societyId
    ? await guardsForSociety(societyId)
    : (await onDutyGuardsAnywhere()).map((g) => ({ ...g, onDuty: true }));

  if (guards.length === 0) return 0;
  let notified = 0;
  for (const g of guards) {
    await providers.messaging.send({
      incidentId: alert.incidentId,
      to: g.phone,
      template: 'guard_alert',
      channel: 'sms',
      params: {
        case: alert.caseType,
        severity: alert.severity,
        flat: alert.flat,
        address: alert.address,
        drill: alert.isDrill ? 'DRILL' : null,
      },
    });
    notified += 1;
    // Within a society, only the on-duty guard is expected to act and the rest
    // are the fallback chain. With no society (an unverified incident) every
    // staffed desk is told, because we cannot tell which one is near.
    if (societyId && g.onDuty) break;
  }
  return notified;
}

export interface FamilyAlert {
  incidentId: string;
  personName: string;
  familyToken: string;
  isDrill: boolean;
  demoSpeed: boolean;
}

export async function alertFamily(personId: string, alert: FamilyAlert): Promise<number> {
  const contacts = await informableFamilyContacts(personId);
  for (const c of contacts) {
    await providers.messaging.send({
      incidentId: alert.incidentId,
      to: c.phone,
      template: 'family_alert',
      channel: 'whatsapp',
      params: {
        person: alert.personName,
        statusUrl: `/family/${alert.familyToken}`,
        drill: alert.isDrill ? 'This is a drill.' : null,
        demo: alert.demoSpeed ? 'Demo speed.' : null,
      },
    });
  }
  return contacts.length;
}

/**
 * The 60 s timer: the family message has not been opened, so call the first
 * contact, then the next (section 8.4).
 */
export async function callFamily(
  incidentId: string,
  personId: string,
  personName: string,
  language: string,
): Promise<boolean> {
  const contacts = await informableFamilyContacts(personId);
  const first = contacts[0];
  if (!first) {
    await appendEvent(incidentId, 'family_unreachable', 'system', null, {
      reason: 'No informable family contact on file.',
    });
    return false;
  }
  await providers.voice.placeCall({
    incidentId,
    to: first.phone,
    flow: 'family_alert',
    language,
    expectPin: false,
  });
  await appendEvent(incidentId, 'family_called', 'system', null, {
    contact: first.name ?? first.phone,
    person: personName,
    simulated: true,
  });
  return true;
}

/** Status message to the person's own phone, inside the free service window. */
export async function messagePerson(
  incidentId: string,
  phone: string,
  template: string,
  params: Record<string, string | number | null>,
): Promise<void> {
  await providers.messaging.send({
    incidentId,
    to: phone,
    template,
    channel: 'whatsapp',
    params,
  });
}
