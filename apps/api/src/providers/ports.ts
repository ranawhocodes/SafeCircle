/**
 * Provider ports (docs/02-architecture.md section 4).
 *
 * Iteration 1 ships a simulated adapter for each. Every result carries
 * `simulated`, and the web layer renders a SIMULATED chip wherever that flag
 * appears - NFR-14 makes honesty structural rather than a promise someone has
 * to remember to keep.
 */
import type { FusedLocation, VerificationOutcome } from '@safecircle/shared';

export interface ProviderResult {
  simulated: boolean;
  /** Provider-side reference, for support and reconciliation. */
  ref?: string;
}

// --- Voice (cancel verification IVR, family escalation call) ----------------

export interface VoiceCallRequest {
  incidentId: string;
  to: string;
  /** `verify_cancel` collects 1/9 and an optional PIN; `family_alert` informs. */
  flow: 'verify_cancel' | 'family_alert' | 'check_in';
  language: string;
  expectPin: boolean;
}

export interface VoicePort {
  readonly name: string;
  /**
   * Place a call. The simulated adapter returns `pending`: the outcome arrives
   * later, from the dashboard in a demo or a provider webhook in production.
   * Dispatch must never block on this.
   */
  placeCall(req: VoiceCallRequest): Promise<ProviderResult & { status: 'pending' | 'failed' }>;
}

export interface VerificationOutcomeEvent {
  incidentId: string;
  attempt: number;
  outcome: VerificationOutcome;
}

// --- Messaging (WhatsApp / SMS to family and the person) --------------------

export interface MessageRequest {
  incidentId?: string;
  to: string;
  /** Named template, because business-initiated WhatsApp messages need one. */
  template: string;
  params: Record<string, string | number | null>;
  channel: 'whatsapp' | 'sms';
}

export interface MessagingPort {
  readonly name: string;
  send(req: MessageRequest): Promise<ProviderResult & { status: 'sent' | 'failed' }>;
}

// --- Push (volunteer app alerts) -------------------------------------------

export interface PushRequest {
  volunteerId: string;
  /** Tier 1 is a full-screen alarm; Tier 2 is a normal notification. */
  priority: 'high' | 'normal';
  kind: 'alert' | 'upgrade' | 'stand_down' | 'covered' | 'still_coming' | 'wake_up';
  payload: Record<string, unknown>;
}

export interface PushPort {
  readonly name: string;
  send(req: PushRequest): Promise<ProviderResult & { delivered: boolean }>;
}

// --- Authority (112 / ERSS handoff) ---------------------------------------

export interface HandoffPacket {
  incidentId: string;
  personName: string | null;
  ageBand: string | null;
  address: string | null;
  location: FusedLocation | null;
  locationDescription: string | null;
  careSummary: string[];
  volunteerObservedType: string | null;
  onScene: Array<{ name: string; badge: string; skill: string | null }>;
  callbackNumbers: string[];
  severity: string;
  openedAt: Date;
}

export interface AuthorityPort {
  readonly name: string;
  /** No real integration exists. The simulated adapter records the packet. */
  handoff(packet: HandoffPacket): Promise<ProviderResult & { accepted: boolean }>;
}

// --- Geolocation (Wi-Fi scan and cell tower -> position) -------------------

export interface GeolocateRequest {
  wifi?: Array<{ bssid: string; rssi: number }>;
  cell?: { mcc: number; mnc: number; tac: number; cell_id: number } | null;
}

export interface GeolocateResult {
  lat: number;
  lng: number;
  accuracyM: number;
  from: 'wifi' | 'cell';
  simulated: boolean;
}

export interface GeolocationPort {
  readonly name: string;
  /** Returns null when nothing in the request can be resolved. */
  locate(req: GeolocateRequest): Promise<GeolocateResult | null>;
}

// --- Identity (DigiLocker government ID) ----------------------------------

export interface IdentityCheckRequest {
  volunteerId: string;
  documentType: 'aadhaar' | 'pan' | 'driving_licence';
  nameOnRecord: string;
}

export interface IdentityCheckResult extends ProviderResult {
  verified: boolean;
  nameMatch: boolean;
  /** Only the last 4 digits are ever stored (section 12.2). */
  maskedId: string;
}

export interface IdentityPort {
  readonly name: string;
  check(req: IdentityCheckRequest): Promise<IdentityCheckResult>;
}

export interface Providers {
  voice: VoicePort;
  messaging: MessagingPort;
  push: PushPort;
  authority: AuthorityPort;
  geolocation: GeolocationPort;
  identity: IdentityPort;
}
