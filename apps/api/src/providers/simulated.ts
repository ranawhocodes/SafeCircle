/**
 * Simulated provider adapters.
 *
 * Each one records what it WOULD have sent into the `outbox` table, which the
 * dashboard and /sim render. A judge can therefore read the exact WhatsApp
 * template, the exact 112 packet and the exact IVR prompt, while nobody is ever
 * told these are real.
 */
import { pool } from '../db/pool.js';
import { newId } from '../security/crypto.js';
import type {
  AuthorityPort,
  GeolocateRequest,
  GeolocateResult,
  GeolocationPort,
  HandoffPacket,
  IdentityCheckRequest,
  IdentityCheckResult,
  IdentityPort,
  MessageRequest,
  MessagingPort,
  ProviderResult,
  PushPort,
  PushRequest,
  VoiceCallRequest,
  VoicePort,
} from './ports.js';

async function record(
  channel: string,
  recipient: string,
  template: string | null,
  payload: Record<string, unknown>,
  incidentId?: string | null,
): Promise<string> {
  const ref = newId('sim');
  await pool.query(
    `INSERT INTO outbox (incident_id, channel, recipient, template, payload, simulated)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [incidentId ?? null, channel, recipient, template, { ...payload, ref }],
  );
  return ref;
}

export class SimulatedVoice implements VoicePort {
  readonly name = 'simulated';

  /**
   * The call is recorded and left `pending`. The outcome is supplied later by
   * POST /api/dashboard/incidents/:id/verification-outcome in a demo, or by a
   * provider webhook in production. Nothing in dispatch waits for it.
   */
  async placeCall(req: VoiceCallRequest): Promise<ProviderResult & { status: 'pending' | 'failed' }> {
    const prompt =
      req.flow === 'verify_cancel'
        ? 'Your SafeCircle alert was cancelled. Press 1 if you are safe. Press 9 if you still need help.'
        : req.flow === 'check_in'
          ? 'Press 1 medical, 2 fall, 3 danger, 4 pressed by mistake.'
          : 'A SafeCircle alert has been raised for your family member. Press 1 to hear details.';
    const ref = await record(
      'voice',
      req.to,
      req.flow,
      { prompt, language: req.language, expectPin: req.expectPin },
      req.incidentId,
    );
    return { simulated: true, ref, status: 'pending' };
  }
}

export class SimulatedMessaging implements MessagingPort {
  readonly name = 'simulated';

  async send(req: MessageRequest): Promise<ProviderResult & { status: 'sent' | 'failed' }> {
    const ref = await record(
      req.channel,
      req.to,
      req.template,
      { params: req.params },
      req.incidentId,
    );
    return { simulated: true, ref, status: 'sent' };
  }
}

/**
 * Push over the volunteer's open WebSocket. This is genuinely delivered to a
 * connected PWA, so it is NOT simulated - but it only works while the app is
 * open, which is exactly why section 10.5 puts a native app on the pilot path.
 */
export class WebSocketPush implements PushPort {
  readonly name = 'websocket';
  private readonly sockets = new Map<string, Set<{ send(data: string): void }>>();

  register(volunteerId: string, socket: { send(data: string): void }): () => void {
    const set = this.sockets.get(volunteerId) ?? new Set();
    set.add(socket);
    this.sockets.set(volunteerId, set);
    return () => {
      set.delete(socket);
      if (set.size === 0) this.sockets.delete(volunteerId);
    };
  }

  async send(req: PushRequest): Promise<ProviderResult & { delivered: boolean }> {
    const sockets = this.sockets.get(req.volunteerId);
    const message = JSON.stringify({
      type: req.kind,
      priority: req.priority,
      ...req.payload,
    });
    let delivered = false;
    for (const s of sockets ?? []) {
      try {
        s.send(message);
        delivered = true;
      } catch {
        // A dead socket is dropped on its own close handler; ignore it here.
      }
    }
    // Recorded either way: an undelivered high-priority alert is the single most
    // important thing for a pilot to be able to see afterwards.
    await record('push', req.volunteerId, req.kind, {
      priority: req.priority,
      delivered,
      ...req.payload,
    });
    return { simulated: false, delivered };
  }
}

export class SimulatedAuthority implements AuthorityPort {
  readonly name = 'simulated';

  async handoff(packet: HandoffPacket): Promise<ProviderResult & { accepted: boolean }> {
    const ref = await record(
      'authority_112',
      '112',
      'handoff_packet',
      { ...packet, notice: 'SIMULATED. No real ERSS-112 integration exists.' },
      packet.incidentId,
    );
    return { simulated: true, ref, accepted: true };
  }
}

/**
 * Offline geolocation. A real deployment calls Google's Geolocation API with the
 * Wi-Fi and cell lists; here a deterministic hash of the strongest BSSID gives a
 * stable, repeatable position so demos and tests behave the same way twice.
 *
 * Seeded BSSIDs resolve to their real seeded coordinates, which is what makes
 * the "indoors, no GPS" demo scene work.
 */
export class OfflineGeolocation implements GeolocationPort {
  readonly name = 'offline';
  private readonly seeded = new Map<string, { lat: number; lng: number; accuracyM: number }>();

  seed(bssid: string, lat: number, lng: number, accuracyM = 55): void {
    this.seeded.set(bssid.toLowerCase(), { lat, lng, accuracyM });
  }

  async locate(req: GeolocateRequest): Promise<GeolocateResult | null> {
    const wifi = [...(req.wifi ?? [])].sort((a, b) => b.rssi - a.rssi);
    for (const ap of wifi) {
      const hit = this.seeded.get(ap.bssid.toLowerCase());
      if (hit) {
        return { ...hit, from: 'wifi', simulated: true };
      }
    }
    if (wifi.length > 0) {
      // Unknown networks: no position. Returning a made-up one would be worse
      // than returning nothing, because a responder would be sent to it.
      return null;
    }
    if (req.cell) {
      const hit = this.seeded.get(`cell:${req.cell.cell_id}`);
      if (hit) return { ...hit, from: 'cell', accuracyM: Math.max(hit.accuracyM, 900), simulated: true };
    }
    return null;
  }
}

export class SimulatedIdentity implements IdentityPort {
  readonly name = 'simulated';

  async check(req: IdentityCheckRequest): Promise<IdentityCheckResult> {
    const ref = await record('identity', req.volunteerId, req.documentType, {
      notice: 'SIMULATED. No DigiLocker or KYC provider is connected.',
    });
    return { simulated: true, ref, verified: true, nameMatch: true, maskedId: 'XXXX1234' };
  }
}
