/** Shared presentational pieces used by every face. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, signIn, verify, type FusedLocationDto, type Meta } from '../lib/api.ts';

/**
 * NFR-14 made visible: wherever a payload says `simulated`, the UI says so too.
 * This component is the only way that claim is rendered, so it cannot drift.
 */
export function SimulatedChip({ what }: { what?: string }): ReactNode {
  return (
    <span className="chip sim" title="This capability is simulated in this build.">
      SIMULATED{what ? `: ${what}` : ''}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: string }): ReactNode {
  const label: Record<string, string> = {
    P1: 'P1 Critical',
    P2: 'P2 Urgent',
    P3: 'P3 Assist',
    unverified: 'Unverified',
  };
  return <span className={`chip ${severity.toLowerCase()}`}>{label[severity] ?? severity}</span>;
}

export function TierChip({ tier }: { tier: number }): ReactNode {
  return (
    <span className={`chip tier${tier}`}>
      {tier === 1 ? 'Tier 1 · you are closest' : 'Tier 2 · nearby'}
    </span>
  );
}

/** The honesty banner. Shown on every face, not tucked away in an About page. */
export function HonestyBanner(): ReactNode {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api.get<Meta>('/api/meta').then(setMeta).catch(() => setMeta(null));
  }, []);
  if (!meta) return null;

  return (
    <div className="notice sim" role="note">
      <div>
        <strong>SafeCircle adds to 112. It does not replace it</strong>, and it never promises that a
        volunteer will come.
        {meta.simulatedCapabilities.length > 0 && (
          <>
            {' '}
            Simulated in this build: {meta.simulatedCapabilities.join('; ')}.
          </>
        )}
        {meta.demoSpeed && (
          <>
            {' '}
            <span className="chip demo">DEMO SPEED ×{meta.demoTimeScale}</span> Timers are compressed,
            so what you see as 10 seconds is 30 in real life.
          </>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }): ReactNode {
  return (
    <p className="muted" role="status">
      {label}…
    </p>
  );
}

export function ErrorNote({ error }: { error: unknown }): ReactNode {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="notice danger" role="alert">
      {message}
    </div>
  );
}

/** Location with its source and accuracy, never bare coordinates (FR-INC-10). */
export function LocationLine({
  location,
  description,
}: {
  location: FusedLocationDto | null;
  description?: string | null;
}): ReactNode {
  if (!location) return <span className="muted">No location yet</span>;
  return (
    <span>
      {description ?? `${location.source}, about ${Math.round(location.accuracyM)} m`}{' '}
      <span className="muted tiny mono">
        {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
      </span>
    </span>
  );
}

export function Clock({ at }: { at: string | Date }): ReactNode {
  const d = typeof at === 'string' ? new Date(at) : at;
  return <time dateTime={d.toISOString()}>{d.toLocaleTimeString()}</time>;
}

/** Seconds since a moment, ticking. Used for "how long has this been open". */
export function Elapsed({ since }: { since: string }): ReactNode {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return (
    <span className="mono" aria-label={`${mm} minutes ${ss} seconds elapsed`}>
      {mm}:{ss}
    </span>
  );
}

export function Progress({ state }: { state: string }): ReactNode {
  const steps = ['Received', 'Helper coming', 'On the way', 'Arrived', 'Resolved'];
  const index: Record<string, number> = {
    new: 0,
    dispatching: 0,
    cancel_verifying: 0,
    accepted: 1,
    en_route: 2,
    on_scene: 3,
    resolved: 4,
  };
  const current = index[state] ?? 0;
  return (
    <>
      <div className="progress" role="img" aria-label={`Stage ${current + 1} of 5: ${steps[current]}`}>
        {steps.map((s, i) => (
          <div key={s} className={`step ${i < current ? 'done' : i === current ? 'active' : ''}`} />
        ))}
      </div>
      <div className="proglabels" aria-hidden="true">
        {steps.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </>
  );
}

/**
 * Poll a loader on an interval. Used instead of WebSockets where a simple
 * refresh is honest enough, and it keeps working if a socket is blocked.
 */
export function usePolling<T>(
  load: () => Promise<T>,
  everyMs: number,
  deps: unknown[] = [],
): { data: T | null; error: unknown; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    const run = async (): Promise<void> => {
      try {
        const value = await loadRef.current();
        if (alive) {
          setData(value);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err);
      }
    };
    void run();
    const t = setInterval(() => void run(), everyMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs, tick, ...deps]);

  return { data, error, reload: () => setTick((n) => n + 1) };
}

/** A one-time-code sign-in panel, shared by every role. */
export function SignInPanel({
  role,
  title,
  hint,
  onSignedIn,
}: {
  role: 'caregiver' | 'volunteer' | 'guard' | 'dashboard';
  title: string;
  hint: ReactNode;
  onSignedIn: () => void;
}): ReactNode {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const request = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setCode('');
    try {
      const res = await signIn(phone, role);
      setSent(true);
      // Outside production the API returns the code, because no SMS is sent.
      if (res.code) setCode(res.code);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await verify(phone, code, role);
      onSignedIn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="notice info">{hint}</div>
      <ErrorNote error={error} />
      <div className="field">
        <label htmlFor="phone">Phone number</label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91…"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      {sent && (
        <div className="field">
          <label htmlFor="code">One-time code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <p className="hint">
            <SimulatedChip what="no SMS was sent" /> The code is filled in for you in this build.
          </p>
        </div>
      )}
      <div className="btnrow" style={{ marginTop: '0.9rem' }}>
        {!sent ? (
          <button className="primary" onClick={() => void request()} disabled={busy || !phone}>
            Send code
          </button>
        ) : (
          <>
            <button className="primary" onClick={() => void confirm()} disabled={busy || !code}>
              Sign in
            </button>
            <button className="ghost" onClick={() => void request()} disabled={busy}>
              Resend code
            </button>
            <button className="ghost" onClick={() => { setSent(false); setCode(''); setError(null); }} disabled={busy}>
              Change number
            </button>
          </>
        )}
      </div>
    </div>
  );
}
