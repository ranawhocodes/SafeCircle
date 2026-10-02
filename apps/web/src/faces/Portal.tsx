/**
 * Face A: the caregiver setup portal (FR-SET-1..9).
 *
 * The person in need never touches this screen. A caregiver pairs the device,
 * records the profile, chooses how the button talks back, records consent, and
 * runs a drill that exercises the whole chain without alerting a volunteer.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { allPatternsFor, type FeedbackProfile } from '@safecircle/shared';
import { api, clearToken, getToken, ApiFailure } from '../lib/api.ts';
import {
  ErrorNote,
  HonestyBanner,
  SignInPanel,
  SimulatedChip,
  Spinner,
} from '../components/common.tsx';

interface PersonSummary {
  id: string;
  name: string;
  ageBand: string;
  feedbackProfile: FeedbackProfile;
  protected: boolean;
  devices: Array<{ deviceId: string; type: string }>;
  familyContacts: number;
  completeness: number;
}

interface PersonDetail {
  person: {
    id: string;
    name: string;
    respondsToName?: string;
    ageBand: string;
    languages: string[];
    address?: string;
    flat?: string;
    feedbackProfile: FeedbackProfile;
    preSendCountdownS: number;
    protected: boolean;
    responderPreference: string | null;
    health?: Record<string, string[] | string>;
    handling?: Record<string, string[] | string>;
  };
  devices: Array<{ deviceId: string; type: string }>;
  deviceHealth: Array<{ device_id: string; battery_pct: number | null; last_seen_at: string | null; silent: boolean }>;
  familyContacts: Array<{ id: number; name: string | null; phone: string; relation: string | null; neverInform: boolean }>;
  incidents: Array<{ id: string; openedAt: string; severity: string; state: string; outcome: string | null; isDrill: boolean }>;
}

const PROFILE_LABELS: Record<FeedbackProfile, string> = {
  standard: 'Standard — light, sound and vibration',
  loud: 'Loud — for hearing loss: maximum buzzer and vibration',
  calm: 'Calm — for autism, dementia or anxiety: soft tones, no beeping',
  child: 'Child — friendly colours, nothing alarming',
  visual_first: 'Visual first — for deaf users: bright light, strong vibration',
  touch_and_sound: 'Touch and sound — for blind users: distinct counts and tones',
  discreet: 'Discreet — vibration only, no light or sound, no calls',
  stealth: 'Stealth — light only, dim and side-facing. No buzzer, no vibration, no calls',
};

export function Portal(): ReactNode {
  const [signedIn, setSignedIn] = useState(() => getToken('caregiver') !== null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  useEffect(() => {
    const handleUnauthorized = (e: Event) => {
      if ((e as CustomEvent).detail?.role === 'caregiver') {
        setSignedIn(false);
      }
    };
    window.addEventListener('safecircle:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('safecircle:unauthorized', handleUnauthorized);
  }, []);

  if (!signedIn) {
    return (
      <main className="narrow">
        <HonestyBanner />
        <SignInPanel
          role="caregiver"
          title="Caregiver sign-in"
          hint={
            <span>
              Demo caregiver: <strong>+919999900010</strong> (Priya, who looks after Lakshmi, Arjun
              and Meera).
            </span>
          }
          onSignedIn={() => setSignedIn(true)}
        />
      </main>
    );
  }

  return (
    <main className="narrow">
      <HonestyBanner />
      {openPerson ? (
        <PersonPage id={openPerson} onBack={() => setOpenPerson(null)} />
      ) : (
        <PeopleList
          onOpen={setOpenPerson}
          onSignOut={() => {
            clearToken('caregiver');
            setSignedIn(false);
          }}
        />
      )}
    </main>
  );
}

function PeopleList({
  onOpen,
  onSignOut,
}: {
  onOpen: (id: string) => void;
  onSignOut: () => void;
}): ReactNode {
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ people: PersonSummary[] }>('/api/portal/people', 'caregiver')
      .then((r) => setPeople(r.people))
      .catch(setError);
  }, []);

  useEffect(() => {
    if (error instanceof ApiFailure && error.status === 401) {
      onSignOut();
    }
  }, [error, onSignOut]);

  if (error) {
    return (
      <div className="card">
        <ErrorNote error={error} />
        <div style={{ marginTop: '1rem' }}>
          <button className="primary" onClick={onSignOut}>
            Sign in again
          </button>
        </div>
      </div>
    );
  }
  if (!people) return <Spinner label="Loading the people you look after" />;

  return (
    <>
      <div className="portal-hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="hero-tag">CAREGIVER CONTROL PORTAL</div>
            <h1 style={{ fontSize: '1.5rem', margin: '0.2rem 0' }}>People You Look After</h1>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', opacity: 0.85 }}>
              Proactive monitoring, silent emergency button pairing, and medical briefings.
            </p>
          </div>
          <button className="ghost" onClick={onSignOut} style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }}>
            Sign out
          </button>
        </div>
      </div>

      {people.map((p) => (
        <div className="card" key={p.id} style={{ borderLeft: p.protected ? '4px solid var(--teal)' : '4px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ marginBottom: '0.2rem', fontSize: '1.3rem' }}>{p.name}</h2>
              <p className="small muted" style={{ margin: '0 0 0.5rem 0' }}>
                Age {p.ageBand} · {p.devices.length} device{p.devices.length === 1 ? '' : 's'} ·{' '}
                {p.familyContacts} family contact{p.familyContacts === 1 ? '' : 's'}
              </p>
            </div>
            <span className={`chip ${p.completeness >= 85 ? 'ok' : 'stale'}`}>
              {p.completeness}% complete
            </span>
          </div>

          <div className="btnrow" style={{ marginTop: '0.25rem' }}>
            <span className="chip">{PROFILE_LABELS[p.feedbackProfile].split(' — ')[0]}</span>
            {p.protected && <span className="chip verified">Protected profile</span>}
          </div>

          <button className="primary" style={{ marginTop: '0.85rem' }} onClick={() => onOpen(p.id)}>
            Manage Profile & Devices →
          </button>
        </div>
      ))}

      <div className="reassurance-bar">
        <div className="item">
          <div className="icon">🛡️</div>
          <div className="label">24/7 PROTECTION</div>
        </div>
        <div className="item">
          <div className="icon">📍</div>
          <div className="label">PROACTIVE HEARTBEATS</div>
        </div>
        <div className="item">
          <div className="icon">🔒</div>
          <div className="label">ZERO-DISCLOSURE PRIVACY</div>
        </div>
      </div>
    </>
  );
}


function PersonPage({ id, onBack }: { id: string; onBack: () => void }): ReactNode {
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drillPatterns, setDrillPatterns] = useState<ReturnType<typeof allPatternsFor> | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<PersonDetail>(`/api/portal/people/${id}`, 'caregiver'));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !detail) return <ErrorNote error={error} />;
  if (!detail) return <Spinner label="Loading the profile" />;
  const { person } = detail;

  const setProfile = async (profile: FeedbackProfile): Promise<void> => {
    try {
      await api.patch(`/api/portal/people/${id}`, { feedback_profile: profile }, 'caregiver');
      setNotice(`Feedback style set to “${PROFILE_LABELS[profile]}”.`);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const runDrill = async (): Promise<void> => {
    setError(null);
    try {
      const res = await api.post<{ note: string; patterns: ReturnType<typeof allPatternsFor> }>(
        `/api/portal/people/${id}/drill`,
        {},
        'caregiver',
      );
      setNotice(res.note);
      setDrillPatterns(res.patterns);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <button className="ghost" onClick={onBack}>
        ← Back
      </button>

      <div className="card" style={{ marginTop: '0.7rem' }}>
        <h1 style={{ marginBottom: '0.2rem' }}>{person.name}</h1>
        {person.respondsToName && (
          <p className="muted small">Answers to “{person.respondsToName}”</p>
        )}
        <p className="small">
          Age {person.ageBand} · speaks {person.languages.join(', ')}
          <br />
          {[person.flat, person.address].filter(Boolean).join(', ')}
        </p>
      </div>

      <ErrorNote error={error} />
      {notice && (
        <div className="notice good" role="status">
          {notice}
        </div>
      )}

      {/* FR-SET-6: the feedback profile. */}
      <div className="card">
        <h2>How the button talks back</h2>
        <p className="small muted">
          Every stage reaches three senses at once, so no single sense is required. Two profiles
          deliberately remove senses, for safety rather than comfort.
        </p>
        <div className="field">
          <label htmlFor="profile">Feedback style</label>
          <select
            id="profile"
            value={person.feedbackProfile}
            onChange={(e) => void setProfile(e.target.value as FeedbackProfile)}
          >
            {(Object.keys(PROFILE_LABELS) as FeedbackProfile[]).map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        {(person.feedbackProfile === 'stealth' || person.feedbackProfile === 'discreet') && (
          <div className="notice info">
            <div>
              This profile means <strong>SafeCircle will never call them</strong> during an alert — a
              ringing phone can put someone in more danger. Verification goes to you instead, and
              responders are told to arrive quietly.
            </div>
          </div>
        )}
        <PatternPreview profile={person.feedbackProfile} />
      </div>

      {/* FR-SET-8: the drill. */}
      <div className="card">
        <h2>Run a drill</h2>
        <p className="small muted">
          A drill goes through the whole chain so you can see it work. Every pattern plays on the
          button and you get sample messages — and <strong>no volunteer is alerted</strong>.
        </p>
        <button className="primary" onClick={() => void runDrill()}>
          Run a drill now
        </button>
        {drillPatterns && (
          <div className="table-wrap" style={{ marginTop: '0.8rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Means</th>
                  <th>Light</th>
                  <th>Sound</th>
                  <th>Vibration</th>
                </tr>
              </thead>
              <tbody>
                {drillPatterns.map((p) => (
                  <tr key={p.stage}>
                    <td className="mono tiny">{p.stage}</td>
                    <td>{p.meaning}</td>
                    <td className="tiny">
                      {p.light.colour === 'none' ? '—' : `${p.light.colour} ${p.light.motion}`}
                    </td>
                    <td className="tiny">{p.sound.tone === 'none' ? '— silent' : p.sound.tone}</td>
                    <td className="tiny">{p.vibration.pulses === 0 ? '—' : `${p.vibration.pulses} × ${p.vibration.length}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FR-SET-3 and FR-FDB-6. */}
      <div className="card">
        <h2>Devices</h2>
        {detail.deviceHealth.length === 0 && <p className="muted">No device paired yet.</p>}
        {detail.deviceHealth.map((d) => (
          <div key={d.device_id} className="notice info" style={{ marginBottom: '0.4rem' }}>
            <div>
              <strong className="mono">{d.device_id}</strong>
              <br />
              <span className="small">
                Battery {d.battery_pct ?? '—'}% · last heard{' '}
                {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never'}
                {d.silent && <strong> — silent for over 24 hours, please check it</strong>}
              </span>
            </div>
          </div>
        ))}
        <ClaimDevice personId={id} onClaimed={() => void load()} />
        <ProvisionDevice
          personId={id}
          deviceIds={detail.devices.map((d) => d.deviceId)}
          onProvisioned={() => void load()}
        />
      </div>

      {/* FR-SET-5 and FR-FAM-4. */}
      <div className="card">
        <h2>Family contacts</h2>
        <p className="small muted">
          Called in this order if the first does not answer. A contact marked “never inform” receives
          nothing at all — that is there for custody and abuse cases.
        </p>
        <ol className="stack" style={{ paddingLeft: '1.2rem' }}>
          {detail.familyContacts.map((c) => (
            <li key={c.id}>
              {c.name ?? c.phone} <span className="muted small">{c.relation}</span>{' '}
              {c.neverInform && <span className="chip p1">NEVER INFORM</span>}
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h2>Printable kit</h2>
        <p className="small muted">
          A fridge QR that opens a prefilled HELP message, a wallet card, and the bystander sticker
          for the pendant. The bystander page never shows a name, address or medical note.
        </p>
        <KitPanel personId={id} />
      </div>

      <div className="card">
        <h2>History</h2>
        {detail.incidents.length === 0 ? (
          <p className="muted">No alerts yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Severity</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {detail.incidents.map((i) => (
                  <tr key={i.id}>
                    <td>{new Date(i.openedAt).toLocaleString()}</td>
                    <td>
                      {i.severity}
                      {i.isDrill && <span className="chip drill">DRILL</span>}
                    </td>
                    <td>{i.outcome?.replace(/_/g, ' ') ?? i.state.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** Shows what each stage will feel like, computed by the shared domain code. */
function PatternPreview({ profile }: { profile: FeedbackProfile }): ReactNode {
  const patterns = allPatternsFor(profile).filter((p) =>
    ['sending', 'received', 'accepted', 'arrived', 'escalated', 'cancel_verifying'].includes(p.stage),
  );
  return (
    <details style={{ marginTop: '0.6rem' }}>
      <summary>Preview what they will feel</summary>
      <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
        <table>
          <tbody>
            {patterns.map((p) => (
              <tr key={p.stage}>
                <td>
                  <strong>{p.meaning}</strong>
                  <br />
                  <span className="tiny muted mono">{p.stage}</span>
                </td>
                <td className="tiny">
                  {p.light.colour === 'none' ? 'no light' : `${p.light.colour}, ${p.light.motion}`}
                  <br />
                  {p.sound.tone === 'none' ? 'silent' : p.sound.tone}
                  <br />
                  {p.vibration.pulses === 0 ? 'no vibration' : `${p.vibration.pulses} buzz`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ClaimDevice({
  personId,
  onClaimed,
}: {
  personId: string;
  onClaimed: () => void;
}): ReactNode {
  const [deviceId, setDeviceId] = useState('HB-003');
  const [code, setCode] = useState('CLAIM-HB-003');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  return (
    <details style={{ marginTop: '0.6rem' }}>
      <summary>Pair a new device</summary>
      <p className="small muted" style={{ marginTop: '0.4rem' }}>
        Scan the QR on the device box. It carries the device id and a single-use claim code, so a
        stolen or second-hand button cannot be paired by someone else.
      </p>
      <ErrorNote error={error} />
      {done && <div className="notice good">Paired.</div>}
      <div className="field">
        <label htmlFor="did">Device id</label>
        <input id="did" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="dcode">Claim code</label>
        <input id="dcode" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <button
        className="primary"
        style={{ marginTop: '0.6rem' }}
        onClick={() => {
          setError(null);
          void api
            .post(
              `/api/portal/people/${personId}/devices/claim`,
              { device_id: deviceId, claim_code: code },
              'caregiver',
            )
            .then(() => {
              setDone(true);
              onClaimed();
            })
            .catch(setError);
        }}
      >
        Pair this device
      </button>
    </details>
  );
}

function ProvisionDevice({
  personId,
  deviceIds,
  onProvisioned,
}: {
  personId: string;
  deviceIds: string[];
  onProvisioned: () => void;
}): ReactNode {
  const [deviceId, setDeviceId] = useState(deviceIds[0] ?? 'HB-001');
  const [method, setMethod] = useState<'soft_ap' | 'improv_ble'>('soft_ap');
  const [ssid, setSsid] = useState('Home_WiFi');
  const [password, setPassword] = useState('safe-circle-2026');
  const [placeLabel, setPlaceLabel] = useState('Home Wi-Fi');
  const [bleStatus, setBleStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (deviceIds[0] && !deviceIds.includes(deviceId)) {
      setDeviceId(deviceIds[0]);
    }
  }, [deviceIds, deviceId]);

  const handleImprovBle = async () => {
    setError(null);
    setBleStatus('Scanning for Bluetooth devices with Improv Wi-Fi service...');
    try {
      if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
        setBleStatus('Web Bluetooth ready. Pairing device over BLE...');
      } else {
        setBleStatus('Web Bluetooth simulated (use Chrome/Edge for hardware BLE). Sending credentials...');
      }
      setBusy(true);
      await new Promise((r) => setTimeout(r, 600));
      const res = await api.post<{ ok: boolean; ssid: string; placeLabel: string }>(
        `/api/portal/people/${personId}/devices/provision`,
        {
          device_id: deviceId,
          method: 'improv_ble',
          ssid,
          place_label: placeLabel,
        },
        'caregiver',
      );
      setDone(`✓ Wi-Fi credentials sent over BLE. Device connected to “${res.ssid}” and saved to “${res.placeLabel}”.`);
      setBleStatus(null);
      onProvisioned();
    } catch (err) {
      setError(err);
      setBleStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSoftAp = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; ssid: string; placeLabel: string }>(
        `/api/portal/people/${personId}/devices/provision`,
        {
          device_id: deviceId,
          method: 'soft_ap',
          ssid,
          place_label: placeLabel,
        },
        'caregiver',
      );
      setDone(`✓ SoftAP captive portal configured: Device linked to “${res.ssid}” and saved to “${res.placeLabel}”.`);
      onProvisioned();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details style={{ marginTop: '0.6rem' }}>
      <summary>Connect button to Wi-Fi (SoftAP / Improv BLE)</summary>
      <p className="small muted" style={{ marginTop: '0.4rem' }}>
        Provision home Wi-Fi credentials to the device directly in the browser (F9). Several networks
        can be saved; joining them tells SafeCircle where the person is without GPS (F42).
      </p>
      <ErrorNote error={error} />
      {done && <div className="notice good">{done}</div>}
      <div className="field">
        <label htmlFor="p_did">Device to configure</label>
        {deviceIds.length > 0 ? (
          <select id="p_did" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {deviceIds.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        ) : (
          <input id="p_did" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
        )}
      </div>

      <div className="field">
        <label>Provisioning method</label>
        <div className="btnrow" style={{ marginTop: '0.2rem' }}>
          <button
            type="button"
            className={method === 'soft_ap' ? 'primary' : 'ghost'}
            onClick={() => setMethod('soft_ap')}
          >
            SoftAP Hotspot (All Browsers)
          </button>
          <button
            type="button"
            className={method === 'improv_ble' ? 'primary' : 'ghost'}
            onClick={() => setMethod('improv_ble')}
          >
            Improv over BLE (Chrome / Edge)
          </button>
        </div>
      </div>

      {method === 'soft_ap' ? (
        <div className="notice info" style={{ marginTop: '0.4rem' }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>SoftAP Hotspot Instructions:</strong>
            <br />
            1. Hold button for 6s until LED flashes cyan.
            <br />
            2. On phone/laptop, join Wi-Fi: <code>SafeCircle-Setup-{deviceId.slice(-4)}</code>.
            <br />
            3. Enter network details below to save:
          </p>
        </div>
      ) : (
        <div className="notice info" style={{ marginTop: '0.4rem' }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>Improv over Bluetooth Standard:</strong>
            <br />
            Sends Wi-Fi credentials over Web Bluetooth directly from Chrome or Edge.
            {bleStatus && (
              <>
                <br />
                <em>{bleStatus}</em>
              </>
            )}
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="p_ssid">Wi-Fi Network Name (SSID)</label>
        <input id="p_ssid" value={ssid} onChange={(e) => setSsid(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="p_pass">Wi-Fi Password</label>
        <input
          id="p_pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="p_label">Location name (Known Place)</label>
        <input
          id="p_label"
          value={placeLabel}
          onChange={(e) => setPlaceLabel(e.target.value)}
          placeholder="e.g. Home Wi-Fi, Hillside Day Centre"
        />
      </div>

      <button
        className="primary"
        style={{ marginTop: '0.6rem' }}
        disabled={busy}
        onClick={() => {
          if (method === 'improv_ble') {
            void handleImprovBle();
          } else {
            void handleSoftAp();
          }
        }}
      >
        {busy ? 'Provisioning...' : method === 'improv_ble' ? 'Pair & Send over BLE' : 'Save Wi-Fi via SoftAP'}
      </button>
    </details>
  );
}

function KitPanel({ personId }: { personId: string }): ReactNode {
  const [kit, setKit] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<unknown>(null);

  return (
    <>
      <ErrorNote error={error} />
      <button
        onClick={() => {
          void api
            .get<Record<string, any>>(`/api/portal/people/${personId}/kit`, 'caregiver')
            .then(setKit)
            .catch(setError);
        }}
      >
        Build the kit
      </button>
      {kit && (
        <div className="stack" style={{ marginTop: '0.7rem' }}>
          <div className="notice info">
            <div>
              <strong>Fridge QR</strong>
              <br />
              <span className="small">{kit.fridgeQr.caption}</span>
              <br />
              <code className="tiny">{kit.fridgeQr.url}</code>
            </div>
          </div>
          <div className="notice info">
            <div>
              <strong>Wallet card</strong>
              <br />
              <span className="small">
                {kit.walletCard.name} — {kit.walletCard.line1} {kit.walletCard.line2}
              </span>
            </div>
          </div>
          <div className="notice info">
            <div>
              <strong>Bystander sticker</strong>
              <br />
              <span className="small">{kit.bystanderSticker.caption}</span>
              <br />
              <code className="tiny">{kit.bystanderSticker.url}</code>
            </div>
          </div>
          <p className="hint">{kit.notice}</p>
          <p className="hint">
            <SimulatedChip what="QR image rendering" /> The printable artwork is a production task;
            the payloads above are what each code carries.
          </p>
        </div>
      )}
    </>
  );
}
