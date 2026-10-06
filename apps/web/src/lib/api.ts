/**
 * API client.
 *
 * One place that knows about tokens, error shape and the `simulated` flag, so no
 * screen has to remember to render the SIMULATED chip itself.
 */

export interface ApiError {
  code: string;
  message: string;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiFailure';
  }
}

/** Session tokens are per role, so one browser can be a volunteer and a guard. */
export type Role = 'caregiver' | 'volunteer' | 'guard' | 'dashboard';

const TOKEN_KEY = (role: Role): string => `safecircle.token.${role}`;

export function getToken(role: Role): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY(role));
  } catch {
    // A private window or blocked storage: the session simply does not persist.
    return null;
  }
}

export function setToken(role: Role, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY(role), token);
  } catch {
    /* non-persistent session */
  }
}

export function clearToken(role: Role): void {
  try {
    localStorage.removeItem(TOKEN_KEY(role));
  } catch {
    /* nothing to clear */
  }
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('safecircle.api_url');
    if (saved) return saved.replace(/\/+$/, '');
  }
  return ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/+$/, '');
}

export function setApiBaseUrl(url: string): void {
  try {
    if (url) {
      localStorage.setItem('safecircle.api_url', url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem('safecircle.api_url');
    }
  } catch {
    /* ignore */
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; role?: Role } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.role) {
    const token = getToken(opts.role);
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const baseUrl = getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    if (res.status === 401 && opts.role) {
      clearToken(opts.role);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('safecircle:unauthorized', { detail: { role: opts.role } }),
        );
      }
    }
    const err = (json as { error?: ApiError } | null)?.error ?? {
      code: 'unknown',
      message: `Request failed (${res.status}).`,
    };
    throw new ApiFailure(res.status, err);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, role?: Role) => request<T>('GET', path, { role }),
  post: <T>(path: string, body?: unknown, role?: Role) => request<T>('POST', path, { body, role }),
  patch: <T>(path: string, body?: unknown, role?: Role) => request<T>('PATCH', path, { body, role }),
  put: <T>(path: string, body?: unknown, role?: Role) => request<T>('PUT', path, { body, role }),
};

export async function signIn(phone: string, role: Role): Promise<{ code?: string }> {
  const res = await api.post<{ ok: boolean; code?: string }>('/api/auth/otp/request', {
    phone,
    role,
  });
  return { code: res.code };
}

export async function verify(phone: string, code: string, role: Role): Promise<void> {
  const res = await api.post<{ token: string }>('/api/auth/otp/verify', { phone, code, role });
  setToken(role, res.token);
}

/** Open a WebSocket with the role's token attached. */
export function openSocket(path: string, role?: Role): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = role ? getToken(role) : null;
  const url = `${proto}://${location.host}${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  return new WebSocket(url);
}

// --- shared response shapes ------------------------------------------------

export interface Meta {
  simulatedCapabilities: string[];
  demoTimeScale: number;
  demoSpeed: boolean;
  notice: string;
}

export interface PreAcceptAlert {
  incidentId: string;
  tier: 1 | 2;
  category: string;
  severity: string;
  ageBand: string;
  distanceBandM: number;
  etaS: number;
  respondersSoFar: number;
  safetyNotice: string | null;
  stealth: boolean;
  isDrill: boolean;
  expiresAt: string;
}

export interface FusedLocationDto {
  lat: number;
  lng: number;
  accuracyM: number;
  source: string;
  at: string;
  label?: string;
}

export interface Briefing {
  viewKind: 'accepted' | 'guard';
  incidentId: string;
  person: { name: string; respondsToName?: string; ageBand: string; photoUrl?: string; languages: string[] };
  location: FusedLocationDto;
  address?: string;
  flat?: string;
  landmark?: string;
  handlingBanner: string[];
  health?: {
    conditions?: string[];
    medicines?: string[];
    allergies?: string[];
    bloodGroup?: string;
    mobilityAids?: string[];
    doctor?: string;
    hospital?: string;
  };
  familyContactMasked?: string;
  guardContactMasked?: string;
  isDrill: boolean;
  accessSecrets?: { gateCode?: string; doorCode?: string; spareKeyHolder?: string };
}

export interface FlashcardSetDto {
  likely: Array<{ key: string; title: string; score: number; because: string[] }>;
  alwaysVisible: { key: string; title: string };
  handlingBanner: string[];
  safetyLine: string;
  disclaimer: string;
}

export interface CardDto {
  key: string;
  title: string;
  group: string;
  body: {
    whatToCheck: string[];
    steps: string[];
    doNot: string[];
    whenToCall112: string[];
    tellTheCrew: string[];
  };
  source: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  disclaimer: string;
}

export interface FamilyStatus {
  incidentId: string;
  state: string;
  severity: string;
  isDrill: boolean;
  demoSpeed: boolean;
  personName: string | null;
  personLocation: FusedLocationDto | null;
  locationDescription: string | null;
  responders: Array<{ name: string; badge: string; skill: string | null; etaS: number | null; status: string }>;
  escalatedTo112: boolean;
  escalationSimulated: boolean;
  volunteerObservedType: string | null;
  timeline: Array<{ at: string; text: string }>;
  outcome: string | null;
  notice: string;
}

export interface DashboardIncident {
  id: string;
  state: string;
  severity: string;
  caseType: string;
  flags: Record<string, boolean>;
  openedAt: string;
  closedAt: string | null;
  outcome: string | null;
  demoSpeed: boolean;
  stale: boolean;
  escalatedTo112: boolean;
  escalationSimulated: boolean;
  volunteerObservedType: string | null;
  person: { name: string; ageBand: string; flat: string | null; address: string | null } | null;
  location: FusedLocationDto | null;
  locationDescription: string | null;
  alerted: number;
  accepted: number;
  declined: number;
}

export interface DashboardDetail {
  incident: DashboardIncident & {
    familyToken: string | null;
    searchRadiusM: number;
    demoTimeScale: number;
    personId: string | null;
  };
  person: {
    name: string;
    ageBand: string;
    flat: string | null;
    address: string | null;
    landmark: string | null;
    feedbackProfile: string;
    protected: boolean;
    handling: Record<string, unknown> | null;
    health: Record<string, unknown> | null;
  } | null;
  dispatches: Array<{
    volunteerId: string;
    name: string;
    badge: string | null;
    skill: string | null;
    tier: number;
    sentAt: string;
    upgradedAt: string | null;
    response: string | null;
    declineReason: string | null;
    rankScore: number | null;
    stoodDownAt: string | null;
  }>;
  rankInputs: Record<string, { because?: string[] } & Record<string, unknown>>;
  locations: Array<FusedLocationDto & { description: string }>;
  timeline: Array<{ seq: number; kind: string; actorType: string; actorId: string | null; payload: Record<string, unknown>; at: string }>;
}
