/**
 * Face A: the caregiver setup portal (FR-SET-1..9).
 *
 * The person in need never touches this screen. A caregiver pairs the device,
 * records the profile, chooses how the button talks back, records consent, and
 * runs a drill that exercises the whole chain without alerting a volunteer.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { allPatternsFor, type FeedbackProfile } from '@safecircle/shared';
import { api, clearToken, getToken } from '../lib/api.ts';
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

  if (error) return <ErrorNote error={error} />;
  if (!people) return <Spinner label="Loading the people you look after" />;

  return (
    <>
      <div className="btnrow" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>People you look after</h1>
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      {people.map((p) => (
        <div className="card" key={p.id}>
          <h2 style={{ marginBottom: '0.2rem' }}>{p.name}</h2>
          <p className="small muted">
            Age {p.ageBand} · {p.devices.length} device{p.devices.length === 1 ? '' : 's'} ·{' '}
            {p.familyContacts} family contact{p.familyContacts === 1 ? '' : 's'}
          </p>
          <div className="btnrow">
            <span className="chip">{PROFILE_LABELS[p.feedbackProfile].split(' — ')[0]}</span>
            {p.protected && <span className="chip verified">Protected profile</span>}
            <span className={`chip ${p.completeness >= 85 ? 'ok' : 'stale'}`}>
              Profile {p.completeness}% complete
            </span>
          </div>
          <button className="primary" style={{ marginTop: '0.7rem' }} onClick={() => onOpen(p.id)}>
            Open
          </button>
        </div>
      ))}
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
