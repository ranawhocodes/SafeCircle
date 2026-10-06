/**
 * Mobile Volunteer App — a standalone, mobile-first experience for SafeCircle
 * volunteer responders. Designed for demo on a real mobile device.
 *
 * Inspired by premium SOS/emergency app UIs: dark backgrounds, bold red
 * accents, oversized typography, bottom tab navigation, and smooth transitions.
 *
 * All underlying functionality delegates to the same API endpoints as the web
 * Volunteer face. The UI wrapper is entirely new.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TUTORIAL_MODULES, QUIZ_QUESTIONS } from '@safecircle/shared';
import {
  api,
  clearToken,
  getToken,
  setToken,
  openSocket,
  getApiBaseUrl,
  setApiBaseUrl,
  ApiFailure,
  type Briefing,
  type CardDto,
  type FlashcardSetDto,
  type PreAcceptAlert,
} from '../lib/api.ts';
import {
  Elapsed,
  ErrorNote,
  LocationLine,
  Spinner,
  usePolling,
} from '../components/common.tsx';
import { MiniMap } from '../components/MiniMap.tsx';
import './volunteer-app.css';

/* ================================================================ */
/* Types                                                             */
/* ================================================================ */

interface Me {
  id: string;
  name: string;
  trustLevel: number;
  badge: string;
  skill: string | null;
  skills: string[];
  availabilityMode: string;
  availableUntil: string | null;
  tutorialComplete: boolean;
  eligibleForTier1: boolean;
}

const CASE_LABELS: Record<string, string> = {
  medical: 'Medical',
  collapse: 'Collapse — not breathing',
  fall: 'Fall',
  child: 'Child',
  cognitive: 'Cognitive disability',
  harassment: 'Harassment / danger',
  fire: 'Fire',
  unknown: 'Unknown',
};

type Tab = 'home' | 'alerts' | 'academy' | 'profile';

/* ================================================================ */
/* Root component                                                    */
/* ================================================================ */

export function VolunteerApp(): ReactNode {
  const [signedIn, setSignedIn] = useState(() => getToken('volunteer') !== null);
  const [showSignup, setShowSignup] = useState(false);

  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail?.role === 'volunteer') setSignedIn(false);
    };
    window.addEventListener('safecircle:unauthorized', h);
    return () => window.removeEventListener('safecircle:unauthorized', h);
  }, []);

  if (!signedIn) {
    return showSignup ? (
      <SignupScreen onDone={() => setSignedIn(true)} onBack={() => setShowSignup(false)} />
    ) : (
      <WelcomeScreen onSignIn={() => setSignedIn(true)} onSignUp={() => setShowSignup(true)} />
    );
  }

  return (
    <AppShell
      onSignOut={() => {
        try { localStorage.removeItem('safecircle.active_incident.volunteer'); } catch { /* */ }
        clearToken('volunteer');
        setSignedIn(false);
      }}
    />
  );
}

/* ================================================================ */
/* Server Config Modal                                               */
/* ================================================================ */

function ServerConfigModal({ onClose }: { onClose: () => void }): ReactNode {
  const [url, setUrl] = useState(() => getApiBaseUrl());
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const target = url.trim().replace(/\/+$/, '') || window.location.origin;
      const res = await fetch(`${target}/health`);
      if (res.ok) {
        setStatus('✅ Connected to SafeCircle API successfully!');
      } else {
        setStatus(`⚠️ Server replied with HTTP ${res.status}`);
      }
    } catch {
      setStatus('❌ Cannot reach server. Check IP & ensure phone & laptop are on same Wi-Fi.');
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    setApiBaseUrl(url);
    onClose();
    window.location.reload();
  };

  return (
    <div className="va-modal-overlay" onClick={onClose}>
      <div className="va-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="va-modal-header">
          <h3>Server Connection</h3>
          <button className="va-modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="va-meta-text">
          When testing on a real mobile device, enter your laptop's local IP address (e.g. <code>http://10.10.58.66:4000</code>).
        </p>
        <div className="va-field" style={{ marginTop: '1rem' }}>
          <label>API Base URL</label>
          <input
            type="url"
            placeholder="http://10.10.58.66:4000 (leave blank for local proxy)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        {status && <div className="va-notice" style={{ marginTop: '0.75rem' }}>{status}</div>}
        <div className="va-btn-row" style={{ marginTop: '1.25rem' }}>
          <button className="va-btn va-btn-ghost va-btn-sm" disabled={testing} onClick={testConnection}>
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button className="va-btn va-btn-primary va-btn-sm" onClick={save}>
            Save & Reload
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ */
/* Welcome / Landing Screen                                          */
/* ================================================================ */

function WelcomeScreen({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }): ReactNode {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServerModal, setShowServerModal] = useState(false);

  const request = async () => {
    setBusy(true);
    setError(null);
    setCode('');
    try {
      const res = await api.post<{ ok: boolean; code?: string }>('/api/auth/otp/request', { phone, role: 'volunteer' });
      setSent(true);
      if (res.code) setCode(res.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string }>('/api/auth/otp/verify', { phone, code, role: 'volunteer' });
      setToken('volunteer', res.token);
      onSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="va-screen va-welcome">
      <button
        className="va-server-btn"
        title="Configure Server IP"
        onClick={() => setShowServerModal(true)}
      >
        ⚙ Server
      </button>

      {showServerModal && <ServerConfigModal onClose={() => setShowServerModal(false)} />}

      {/* Hero section */}
      <div className="va-welcome-hero">
        <div className="va-welcome-rings">
          <div className="va-ring va-ring-1" />
          <div className="va-ring va-ring-2" />
          <div className="va-ring va-ring-3" />
          <div className="va-welcome-icon">
            <svg viewBox="0 0 24 24" fill="none" width="48" height="48">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
            </svg>
          </div>
        </div>
        <h1 className="va-welcome-title">SafeCircle</h1>
        <p className="va-welcome-tagline">VOLUNTEER RESPONDER</p>
        <p className="va-welcome-subtitle">Expert Help. Anytime.</p>
      </div>

      {/* Sign in form */}
      <div className="va-welcome-form">
        {error && <div className="va-error">{error}</div>}

        <div className="va-field">
          <label>Phone Number</label>
          <input
            type="tel"
            inputMode="tel"
            placeholder="+91…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        {sent && (
          <div className="va-field">
            <label>One-Time Code</label>
            <input
              inputMode="numeric"
              placeholder="Enter code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="va-hint">Demo: code is auto-filled. No SMS sent.</p>
          </div>
        )}

        {!sent ? (
          <button className="va-btn va-btn-primary va-btn-block" disabled={busy || !phone} onClick={() => void request()}>
            Sign In
          </button>
        ) : (
          <div className="va-btn-stack">
            <button className="va-btn va-btn-primary va-btn-block" disabled={busy || !code} onClick={() => void confirm()}>
              Verify & Sign In
            </button>
            <button className="va-btn va-btn-ghost" disabled={busy} onClick={() => void request()}>
              Resend Code
            </button>
          </div>
        )}

        <div className="va-divider">
          <span>New volunteer?</span>
        </div>

        <button className="va-btn va-btn-outline va-btn-block" onClick={onSignUp}>
          Sign Up as Volunteer
        </button>

        <p className="va-demo-hint">
          Demo: <strong>+919999900101</strong> (Priya, Nurse) · <strong>+919999900102</strong> (Arun, First-aider)
        </p>
      </div>

      {/* Feature badges */}
      <div className="va-features">
        {[
          ['🛡️', '24/7', 'PROTECTION'],
          ['📍', 'REAL-TIME', 'LOCATION'],
          ['🔒', 'PRIVATE &', 'SECURE'],
        ].map(([icon, l1, l2]) => (
          <div key={l2} className="va-feature">
            <span className="va-feature-icon">{icon}</span>
            <span className="va-feature-label">{l1}<br />{l2}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================ */
/* Signup Screen                                                     */
/* ================================================================ */

function SignupScreen({ onDone, onBack }: { onDone: () => void; onBack: () => void }): ReactNode {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [languages, setLanguages] = useState<string[]>(['en']);
  const [skills, setSkills] = useState<string[]>([]);
  const [isWoman, setIsWoman] = useState<boolean | null>(null);
  const [transport, setTransport] = useState('walk');

  const toggleLanguage = (lang: string) => {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]);
  };
  const toggleSkill = (skill: string) => {
    setSkills(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; token: string; volunteerId: string }>('/api/auth/volunteer/signup', {
        name,
        phone,
        languages,
        skills: skills.length > 0 ? skills : undefined,
        isWoman: isWoman ?? undefined,
        transport,
      });
      setToken('volunteer', res.token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    // Step 0: Personal info
    <div key="step0" className="va-signup-step">
      <div className="va-signup-icon">👤</div>
      <h2>Your Details</h2>
      <p className="va-signup-desc">Tell us about yourself so we can match you to the right emergencies.</p>
      <div className="va-field">
        <label>Full Name</label>
        <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="va-field">
        <label>Phone Number</label>
        <input type="tel" inputMode="tel" placeholder="+91…" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      <div className="va-field">
        <label>Gender (optional)</label>
        <div className="va-toggle-group">
          {([['Male', false], ['Female', true], ['Prefer not to say', null]] as const).map(([label, val]) => (
            <button
              key={label}
              className={`va-toggle-btn ${isWoman === val ? 'active' : ''}`}
              onClick={() => setIsWoman(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>,

    // Step 1: Languages & Skills
    <div key="step1" className="va-signup-step">
      <div className="va-signup-icon">🌍</div>
      <h2>Languages & Skills</h2>
      <p className="va-signup-desc">Help us understand what you can offer during an emergency.</p>
      <div className="va-field">
        <label>Languages you speak</label>
        <div className="va-chip-group">
          {[
            ['en', 'English'], ['ta', 'Tamil'], ['hi', 'Hindi'], ['te', 'Telugu'],
            ['kn', 'Kannada'], ['ml', 'Malayalam'], ['bn', 'Bengali'], ['mr', 'Marathi'],
          ].map(([code, label]) => (
            <button
              key={code}
              className={`va-chip-btn ${languages.includes(code!) ? 'active' : ''}`}
              onClick={() => toggleLanguage(code!)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="va-field">
        <label>Medical / Safety Skills (optional)</label>
        <div className="va-chip-group">
          {[
            ['first_aider', '🩹 First Aider'],
            ['nurse', '👩‍⚕️ Nurse'],
            ['doctor', '🩺 Doctor'],
            ['paramedic', '🚑 Paramedic'],
            ['firefighter', '🚒 Firefighter'],
            ['lifeguard', '🏊 Lifeguard'],
          ].map(([code, label]) => (
            <button
              key={code}
              className={`va-chip-btn ${skills.includes(code!) ? 'active' : ''}`}
              onClick={() => toggleSkill(code!)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>,

    // Step 2: Transport & confirm
    <div key="step2" className="va-signup-step">
      <div className="va-signup-icon">🚀</div>
      <h2>Almost There!</h2>
      <p className="va-signup-desc">One last thing — how do you usually get around?</p>
      <div className="va-field">
        <label>Transport Mode</label>
        <div className="va-toggle-group">
          {[['walk', '🚶 Walk'], ['cycle', '🚴 Cycle'], ['two_wheeler', '🏍️ Two-wheeler']].map(([val, label]) => (
            <button
              key={val}
              className={`va-toggle-btn ${transport === val ? 'active' : ''}`}
              onClick={() => setTransport(val!)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="va-error">{error}</div>}
      <div className="va-signup-summary">
        <h3>Your Profile</h3>
        <div className="va-summary-row"><span>Name</span><strong>{name || '—'}</strong></div>
        <div className="va-summary-row"><span>Phone</span><strong>{phone || '—'}</strong></div>
        <div className="va-summary-row"><span>Languages</span><strong>{languages.join(', ') || '—'}</strong></div>
        {skills.length > 0 && <div className="va-summary-row"><span>Skills</span><strong>{skills.join(', ')}</strong></div>}
        <div className="va-summary-row"><span>Transport</span><strong>{transport}</strong></div>
      </div>
    </div>,
  ];

  const canNext = step === 0 ? name.trim().length > 0 && phone.trim().length > 0
    : step === 1 ? languages.length > 0
    : true;

  return (
    <div className="va-screen va-signup">
      <header className="va-signup-header">
        <button className="va-btn-icon" onClick={step > 0 ? () => setStep(step - 1) : onBack}>
          <svg viewBox="0 0 24 24" width="24" height="24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor"/></svg>
        </button>
        <div className="va-signup-progress">
          {[0, 1, 2].map(i => (
            <div key={i} className={`va-progress-dot ${i <= step ? 'active' : ''}`} />
          ))}
        </div>
        <span className="va-step-label">Step {step + 1} of 3</span>
      </header>

      <div className="va-signup-body">
        {steps[step]}
      </div>

      <div className="va-signup-footer">
        {step < 2 ? (
          <button className="va-btn va-btn-primary va-btn-block" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : (
          <button className="va-btn va-btn-accent va-btn-block" disabled={busy || !canNext} onClick={() => void submit()}>
            {busy ? 'Creating Account…' : 'Join SafeCircle'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================ */
/* Main App Shell with bottom nav                                    */
/* ================================================================ */

function AppShell({ onSignOut }: { onSignOut: () => void }): ReactNode {
  const [tab, setTab] = useState<Tab>('home');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [activeIncident, setActiveIncident] = useState<string | null>(() => {
    try { return localStorage.getItem('safecircle.active_incident.volunteer'); } catch { return null; }
  });
  const [liveNudge, setLiveNudge] = useState<string | null>(null);

  const setAndPersist = useCallback((id: string | null) => {
    setActiveIncident(id);
    try {
      if (id) localStorage.setItem('safecircle.active_incident.volunteer', id);
      else localStorage.removeItem('safecircle.active_incident.volunteer');
    } catch { /* */ }
  }, []);

  const loadMe = useCallback(async () => {
    try { setMe(await api.get<Me>('/api/volunteer/me', 'volunteer')); }
    catch (err) { setError(err); }
  }, []);

  useEffect(() => {
    if (error instanceof ApiFailure && error.status === 401) onSignOut();
  }, [error, onSignOut]);

  useEffect(() => { void loadMe(); }, [loadMe]);

  const { data: alertData, reload: reloadAlerts } = usePolling(
    () => api.get<{ alerts: PreAcceptAlert[]; activeIncidentId?: string | null }>('/api/volunteer/alerts', 'volunteer'),
    3000,
  );

  useEffect(() => {
    if (alertData?.activeIncidentId !== undefined) setAndPersist(alertData.activeIncidentId);
  }, [alertData?.activeIncidentId, setAndPersist]);

  useEffect(() => {
    const handleReset = () => { setAndPersist(null); reloadAlerts(); };
    const handleStorage = (e: StorageEvent) => { if (e.key === 'safecircle:demo-reset') handleReset(); };
    window.addEventListener('safecircle:demo-reset', handleReset);
    window.addEventListener('storage', handleStorage);
    return () => { window.removeEventListener('safecircle:demo-reset', handleReset); window.removeEventListener('storage', handleStorage); };
  }, [setAndPersist, reloadAlerts]);

  useEffect(() => {
    const socket = openSocket('/ws/volunteer', 'volunteer');
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type: string; message?: string };
        if (msg.type === 'alert' || msg.type === 'upgrade') reloadAlerts();
        if (['covered', 'stand_down', 'still_coming'].includes(msg.type)) {
          setLiveNudge(msg.message ?? null);
          reloadAlerts();
        }
      } catch { /* */ }
    };
    return () => socket.close();
  }, [reloadAlerts]);

  const alerts = alertData?.alerts ?? [];

  // Active mission takes over the screen
  if (activeIncident) {
    return (
      <div className="va-app">
        <MissionScreen
          incidentId={activeIncident}
          onDone={() => { setAndPersist(null); reloadAlerts(); }}
        />
      </div>
    );
  }

  return (
    <div className="va-app">
      <div className="va-content">
        {tab === 'home' && (
          <HomeTab
            me={me}
            alerts={alerts}
            liveNudge={liveNudge}
            onDismissNudge={() => setLiveNudge(null)}
            onResponded={(incidentId, accepted) => {
              if (accepted) setAndPersist(incidentId);
              else reloadAlerts();
            }}
            onAvailabilityChanged={() => { void loadMe(); void reloadAlerts(); }}
          />
        )}
        {tab === 'alerts' && (
          <AlertsTab
            alerts={alerts}
            onResponded={(incidentId, accepted) => {
              if (accepted) setAndPersist(incidentId);
              else reloadAlerts();
            }}
          />
        )}
        {tab === 'academy' && me && (
          <AcademyTab me={me} onChanged={() => void loadMe()} />
        )}
        {tab === 'profile' && me && (
          <ProfileTab me={me} onSignOut={onSignOut} onChanged={() => void loadMe()} />
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="va-nav">
        {([
          ['home', '🏠', 'Home'],
          ['alerts', '🔔', 'Alerts'],
          ['academy', '🎓', 'Academy'],
          ['profile', '👤', 'Profile'],
        ] as const).map(([key, icon, label]) => (
          <button
            key={key}
            className={`va-nav-item ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            <span className="va-nav-icon">{icon}</span>
            <span className="va-nav-label">{label}</span>
            {key === 'alerts' && alerts.length > 0 && (
              <span className="va-nav-badge">{alerts.length}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ================================================================ */
/* Home Tab                                                          */
/* ================================================================ */

function HomeTab({
  me,
  alerts,
  liveNudge,
  onDismissNudge,
  onResponded,
  onAvailabilityChanged,
}: {
  me: Me | null;
  alerts: PreAcceptAlert[];
  liveNudge: string | null;
  onDismissNudge: () => void;
  onResponded: (incidentId: string, accepted: boolean) => void;
  onAvailabilityChanged: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const on = me?.availabilityMode !== 'off';

  const toggleAvailability = async () => {
    setBusy(true);
    try {
      await api.post('/api/volunteer/availability', { mode: on ? 'off' : 'available_now' }, 'volunteer');
      onAvailabilityChanged();
    } catch { /* */ }
    finally { setBusy(false); }
  };

  const tier1 = alerts.find(a => a.tier === 1);

  return (
    <div className="va-tab">
      {/* Welcome header */}
      <header className="va-home-header">
        <div className="va-home-greeting">
          <span className="va-home-label">WELCOME BACK,</span>
          <h1 className="va-home-name">{me?.name ?? '…'}</h1>
        </div>
        <div className="va-home-status">
          <span className={`va-status-dot ${on ? 'online' : 'offline'}`} />
          <span className="va-status-text">{on ? 'On Duty' : 'Off Duty'}</span>
        </div>
      </header>

      {liveNudge && (
        <div className="va-nudge">
          <span>{liveNudge}</span>
          <button className="va-btn-icon va-btn-icon-sm" onClick={onDismissNudge}>✕</button>
        </div>
      )}

      {/* Active SOS Card */}
      {tier1 ? (
        <MobileAlertCard alert={tier1} onResponded={(acc) => onResponded(tier1.incidentId, acc)} />
      ) : (
        <div className="va-sos-card" onClick={() => on ? undefined : void toggleAvailability()}>
          <div className="va-sos-card-inner">
            <span className="va-sos-label">{on ? 'STANDING BY' : 'GO AVAILABLE'}</span>
            <span className="va-sos-big">{on ? 'READY' : 'TAP TO START'}</span>
            <div className={`va-sos-pulse ${on ? 'active' : ''}`}>
              <div className="va-sos-dot" />
            </div>
          </div>
        </div>
      )}

      {/* Quick Services */}
      <section className="va-section">
        <h3 className="va-section-title">QUICK SERVICES</h3>
        {[
          ['🏥', 'Medical Emergency', 'Connect to medical experts', 'medical'],
          ['🛡️', 'Security Assistance', 'Request immediate security', 'harassment'],
          ['🚗', 'Roadside Help', 'Get help on the road', 'unknown'],
          ['✈️', 'Travel Assistance', "Support while you're away", 'unknown'],
        ].map(([icon, title, desc]) => (
          <div key={title} className="va-service-row">
            <span className="va-service-icon">{icon}</span>
            <div className="va-service-info">
              <strong>{title}</strong>
              <span>{desc}</span>
            </div>
            <span className="va-service-arrow">›</span>
          </div>
        ))}
      </section>

      {/* Tier 2 alerts */}
      {alerts.filter(a => a.tier === 2).map(a => (
        <MobileAlertCard key={a.incidentId} alert={a} onResponded={(acc) => onResponded(a.incidentId, acc)} />
      ))}

      {/* Availability toggle */}
      <section className="va-section">
        <h3 className="va-section-title">AVAILABILITY</h3>
        <button
          className={`va-btn va-btn-block ${on ? 'va-btn-danger' : 'va-btn-primary'}`}
          disabled={busy || (me !== null && !me.tutorialComplete)}
          onClick={() => void toggleAvailability()}
        >
          {on ? '⏸ Go Off Duty' : '▶ Go On Duty'}
        </button>
        {me && !me.tutorialComplete && (
          <p className="va-hint" style={{ marginTop: '0.5rem' }}>Complete the Academy first to go on duty.</p>
        )}
      </section>

      {/* Bottom reassurance */}
      <div className="va-reassurance">
        <span>🔒 100% PRIVATE & CONFIDENTIAL</span>
      </div>
    </div>
  );
}

/* ================================================================ */
/* Alerts Tab                                                        */
/* ================================================================ */

function AlertsTab({
  alerts,
  onResponded,
}: {
  alerts: PreAcceptAlert[];
  onResponded: (incidentId: string, accepted: boolean) => void;
}): ReactNode {
  return (
    <div className="va-tab">
      <header className="va-tab-header">
        <h1>Alerts</h1>
        <span className="va-badge-count">{alerts.length} active</span>
      </header>

      {alerts.length === 0 ? (
        <div className="va-empty">
          <div className="va-empty-icon">🔔</div>
          <h3>All Clear</h3>
          <p>No active alerts right now. You'll be notified instantly when someone nearby needs help.</p>
        </div>
      ) : (
        alerts.map(a => (
          <MobileAlertCard
            key={a.incidentId}
            alert={a}
            onResponded={(acc) => onResponded(a.incidentId, acc)}
          />
        ))
      )}
    </div>
  );
}

/* ================================================================ */
/* Mobile Alert Card                                                 */
/* ================================================================ */

function MobileAlertCard({
  alert,
  onResponded,
}: {
  alert: PreAcceptAlert;
  onResponded: (accepted: boolean) => void;
}): ReactNode {
  const [slide, setSlide] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [declining, setDeclining] = useState(false);
  const [acknowledgedSafety, setAcknowledgedSafety] = useState(false);

  const needsSafetyAck = alert.safetyNotice !== null;
  const canAccept = slide >= 95 && (!needsSafetyAck || acknowledgedSafety);

  const respond = async (response: 'accepted' | 'declined', reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/incidents/${alert.incidentId}/respond`, { response, reason }, 'volunteer');
      onResponded(response === 'accepted');
    } catch (err) {
      setError(err);
      setSlide(0);
    } finally {
      setBusy(false);
    }
  };

  const isTier1 = alert.tier === 1;

  return (
    <div className={`va-alert-card ${isTier1 ? 'tier1' : 'tier2'}`}>
      <div className="va-alert-header">
        <span className={`va-tier-badge ${isTier1 ? 'critical' : 'normal'}`}>
          {isTier1 ? 'TIER 1 · CLOSEST' : 'TIER 2 · NEARBY'}
        </span>
        {alert.isDrill && <span className="va-drill-badge">DRILL</span>}
      </div>

      <h2 className="va-alert-title">
        {isTier1 ? 'You Are the Closest Helper' : 'Help Needed Nearby'}
      </h2>

      <div className="va-alert-meta">
        <div className="va-meta-item">
          <span className="va-meta-label">Situation</span>
          <span className="va-meta-value">{CASE_LABELS[alert.category] ?? alert.category}</span>
        </div>
        <div className="va-meta-item">
          <span className="va-meta-label">Distance</span>
          <span className="va-meta-value">~{alert.distanceBandM}m</span>
        </div>
        <div className="va-meta-item">
          <span className="va-meta-label">ETA</span>
          <span className="va-meta-value">{Math.max(1, Math.round(alert.etaS / 60))} min</span>
        </div>
        <div className="va-meta-item">
          <span className="va-meta-label">Age</span>
          <span className="va-meta-value">{alert.ageBand}</span>
        </div>
      </div>

      <p className="va-alert-responders">
        {alert.respondersSoFar === 0 ? 'Nobody has accepted yet.' : `${alert.respondersSoFar} already responding.`}
      </p>

      {alert.safetyNotice && (
        <div className="va-safety-notice">
          <span>{alert.safetyNotice}</span>
          <label className="va-safety-check">
            <input
              type="checkbox"
              checked={acknowledgedSafety}
              onChange={e => setAcknowledgedSafety(e.target.checked)}
            />
            I understand and will not confront anyone
          </label>
        </div>
      )}

      {error ? <div className="va-error">{error instanceof Error ? error.message : String(error)}</div> : null}

      {!declining ? (
        <div className="va-alert-actions">
          <div className="va-slider-wrap">
            <label className="va-slider-label">Slide to accept →</label>
            <input
              type="range"
              min={0}
              max={100}
              value={slide}
              onChange={e => setSlide(Number(e.target.value))}
              className="va-slider"
            />
          </div>
          <div className="va-btn-row">
            <button
              className={`va-btn ${isTier1 ? 'va-btn-accent' : 'va-btn-primary'} va-btn-block`}
              disabled={!canAccept || busy}
              onClick={() => void respond('accepted')}
            >
              {canAccept ? '✓ Accept & Go' : 'Slide to Accept'}
            </button>
            <button className="va-btn va-btn-ghost" disabled={busy} onClick={() => setDeclining(true)}>
              Can't Go
            </button>
          </div>
        </div>
      ) : (
        <div className="va-decline-options">
          <p><strong>Why not?</strong> This helps dispatch learn.</p>
          <div className="va-btn-row">
            {[['too_far', 'Too Far'], ['busy', 'Busy'], ['not_safe', 'Not Safe'], ['not_trained', 'Not Trained']].map(
              ([reason, label]) => (
                <button key={reason} className="va-btn va-btn-outline" disabled={busy} onClick={() => void respond('declined', reason)}>
                  {label}
                </button>
              ),
            )}
          </div>
          <button className="va-btn va-btn-ghost" onClick={() => setDeclining(false)}>Back</button>
        </div>
      )}
    </div>
  );
}

/* ================================================================ */
/* Mission Screen                                                    */
/* ================================================================ */

function MissionScreen({ incidentId, onDone }: { incidentId: string; onDone: () => void }): ReactNode {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [cards, setCards] = useState<FlashcardSetDto | null>(null);
  const [openCard, setOpenCard] = useState<CardDto | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string>('accepted');
  const [busy, setBusy] = useState(false);
  const [dangerSent, setDangerSent] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState(false);

  const reportDanger = async () => {
    setBusy(true);
    try {
      await api.post('/api/volunteer/danger', { incidentId }, 'volunteer');
      setDangerSent(true);
      setDangerConfirm(false);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    void (async () => {
      try {
        setBriefing(await api.get<Briefing>(`/api/incidents/${incidentId}/briefing`, 'volunteer'));
        setCards(await api.get<FlashcardSetDto>(`/api/incidents/${incidentId}/flashcards`, 'volunteer'));
      } catch (err) {
        if (err instanceof ApiFailure && (err.status === 403 || err.status === 404)) { onDone(); return; }
        setError(err);
      }
    })();
  }, [incidentId, onDone]);

  useEffect(() => {
    if (status !== 'en_route' && status !== 'accepted') return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => { void api.post('/api/volunteer/location', { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy, incident_id: incidentId }, 'volunteer').catch(() => {}); },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [incidentId, status]);

  const openCardByKey = async (key: string) => {
    try { setOpenCard(await api.get<CardDto>(`/api/cards/${key}`, 'volunteer')); }
    catch (err) { setError(err); }
  };

  const chooseCard = async (key: string) => {
    setChosen(key);
    await openCardByKey(key);
    try { await api.post(`/api/incidents/${incidentId}/card-selection`, { card_key: key }, 'volunteer'); }
    catch (err) { setError(err); }
  };

  const tapStatus = async (next: string, note?: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; state?: string }>(`/api/incidents/${incidentId}/status`, { status: next, note }, 'volunteer');
      setStatus(res.state ?? next);
      if (['resolved', 'handed_to_ambulance', 'cant_attend'].includes(next)) onDone();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  if (error && !briefing) {
    return (
      <div className="va-tab" style={{ paddingTop: '2rem' }}>
        <ErrorNote error={error} />
        <button className="va-btn va-btn-primary va-btn-block" onClick={onDone}>Back to Alerts</button>
      </div>
    );
  }
  if (!briefing) return <div className="va-tab va-loading"><Spinner label="Opening briefing" /></div>;

  return (
    <div className="va-tab va-mission">
      {/* Mission header */}
      <header className="va-mission-header">
        <button className="va-btn-icon" onClick={onDone}>
          <svg viewBox="0 0 24 24" width="24" height="24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor"/></svg>
        </button>
        <h2>Active Mission</h2>
        <span className="va-mission-status">{status.replace(/_/g, ' ')}</span>
      </header>

      {briefing.isDrill && (
        <div className="va-notice va-notice-info">
          <strong>This is a drill.</strong> Nobody actually needs help.
        </div>
      )}

      <div className="va-notice va-notice-danger">
        {cards?.safetyLine ?? 'Check for danger before you go in.'}
      </div>

      {briefing.handlingBanner.length > 0 && (
        <div className="va-notice va-notice-info">
          <strong>How to approach:</strong>
          <ul>
            {briefing.handlingBanner.map(line => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      {/* Person card */}
      <div className="va-card">
        <h2>{briefing.person.name}
          {briefing.person.respondsToName && <span className="va-sub"> — "{briefing.person.respondsToName}"</span>}
        </h2>
        <p className="va-meta-text">Age {briefing.person.ageBand} · speaks {briefing.person.languages.join(', ')}</p>
        <p className="va-address">
          <strong>{[briefing.flat, briefing.address].filter(Boolean).join(', ')}</strong>
          {briefing.landmark && <span className="va-sub"> · {briefing.landmark}</span>}
        </p>
        <div className="va-minimap-wrap">
          <MiniMap
            center={[briefing.location.lat, briefing.location.lng]}
            accuracyM={briefing.location.accuracyM}
            label={briefing.person.name}
          />
        </div>

        {briefing.accessSecrets && (
          <div className="va-notice va-notice-info" style={{ marginTop: '0.75rem' }}>
            <strong>Access:</strong>
            {briefing.accessSecrets.gateCode && <> Gate: {briefing.accessSecrets.gateCode}. </>}
            {briefing.accessSecrets.doorCode && <> Door: {briefing.accessSecrets.doorCode}. </>}
            {briefing.accessSecrets.spareKeyHolder && <> Spare key: {briefing.accessSecrets.spareKeyHolder}.</>}
          </div>
        )}

        {briefing.health && (
          <details className="va-details">
            <summary><strong>Medical Notes</strong></summary>
            <ul>
              {briefing.health.conditions?.length ? <li>Conditions: {briefing.health.conditions.join(', ')}</li> : null}
              {briefing.health.medicines?.length ? <li>Medicines: {briefing.health.medicines.join(', ')}</li> : null}
              {briefing.health.allergies?.length ? <li>Allergies: {briefing.health.allergies.join(', ')}</li> : null}
              {briefing.health.bloodGroup ? <li>Blood group: {briefing.health.bloodGroup}</li> : null}
            </ul>
          </details>
        )}
      </div>

      {/* Flashcards */}
      {cards && (
        <div className="va-card">
          <h3>What will you find?</h3>
          <p className="va-meta-text">{cards.disclaimer}</p>
          <div className="va-flashcard-grid">
            {cards.likely.map(c => (
              <button
                key={c.key}
                className={`va-flashcard ${chosen === c.key ? 'selected' : ''}`}
                onClick={() => void chooseCard(c.key)}
              >
                <strong>{c.title}</strong>
                <span className="va-flashcard-why">{c.because[0]}</span>
              </button>
            ))}
          </div>
          <button className="va-btn va-btn-danger va-btn-block" style={{ marginTop: '0.5rem' }}
            onClick={() => void chooseCard(cards.alwaysVisible.key)}
          >
            Not breathing? Start CPR
          </button>
        </div>
      )}

      {openCard && <MobileCardPanel card={openCard} onClose={() => setOpenCard(null)} />}

      {/* Danger SOS */}
      <div className={`va-card va-danger-card ${dangerSent ? 'sent' : ''}`}>
        {dangerSent ? (
          <div className="va-danger-sent">
            <span>🚨</span>
            <div>
              <strong>Emergency SOS Broadcasted</strong>
              <p>112 and control room alerted to your position. Stay safe.</p>
            </div>
          </div>
        ) : !dangerConfirm ? (
          <div className="va-danger-idle">
            <div>
              <h3>⚠️ Responder Safety</h3>
              <p>Feel unsafe on scene?</p>
            </div>
            <button className="va-btn va-btn-danger" disabled={busy} onClick={() => setDangerConfirm(true)}>
              🚨 I'm in Danger
            </button>
          </div>
        ) : (
          <div className="va-btn-row">
            <button className="va-btn va-btn-danger" disabled={busy} onClick={() => void reportDanger()}>
              Confirm: Alert 112
            </button>
            <button className="va-btn va-btn-ghost" disabled={busy} onClick={() => setDangerConfirm(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Status buttons */}
      <div className="va-card">
        <h3>Status Updates</h3>
        <div className="va-status-grid">
          <button className="va-btn va-btn-primary" disabled={busy} onClick={() => void tapStatus('on_my_way')}>🚶 On My Way</button>
          <button className="va-btn va-btn-primary" disabled={busy} onClick={() => void tapStatus('arrived')}>📍 Arrived</button>
          <button className="va-btn va-btn-warning" disabled={busy} onClick={() => void tapStatus('need_backup')}>🆘 Need Backup</button>
          <button className="va-btn va-btn-outline" disabled={busy} onClick={() => void tapStatus('handed_to_ambulance')}>🚑 Handed to Ambulance</button>
          <button className="va-btn va-btn-outline" disabled={busy} onClick={() => void tapStatus('resolved')}>✅ Resolved</button>
          <button className="va-btn va-btn-ghost" disabled={busy} onClick={() => void tapStatus('cant_attend')}>✕ Can't Attend</button>
        </div>
      </div>

      {/* Contact */}
      <div className="va-card">
        <h3>Contact</h3>
        <p className="va-meta-text">Calls go through number masking.</p>
        <div className="va-btn-row">
          <button className="va-btn va-btn-outline" disabled>📞 Family</button>
          <button className="va-btn va-btn-outline" disabled>📞 Guard</button>
          <button className="va-btn va-btn-danger">📞 Call 112</button>
        </div>
      </div>

      <ErrorNote error={error} />
    </div>
  );
}

function MobileCardPanel({ card, onClose }: { card: CardDto; onClose: () => void }): ReactNode {
  return (
    <div className="va-card va-card-detail">
      <div className="va-card-detail-header">
        <h3>{card.title}</h3>
        <button className="va-btn-icon va-btn-icon-sm" onClick={onClose}>✕</button>
      </div>
      <p className="va-meta-text">{card.disclaimer} Source: {card.source}.</p>
      {card.body.whatToCheck.length > 0 && (
        <><h4>Check</h4><ul>{card.body.whatToCheck.map(s => <li key={s}>{s}</li>)}</ul></>
      )}
      <h4>Do This</h4>
      <ol>{card.body.steps.map(s => <li key={s}>{s}</li>)}</ol>
      <h4 className="va-red">Do NOT</h4>
      <ul className="va-dont">{card.body.doNot.map(s => <li key={s}>{s}</li>)}</ul>
      <h4>Call 112 If</h4>
      <ul>{card.body.whenToCall112.map(s => <li key={s}>{s}</li>)}</ul>
    </div>
  );
}

/* ================================================================ */
/* Academy Tab                                                       */
/* ================================================================ */

function AcademyTab({ me, onChanged }: { me: Me; onChanged: () => void }): ReactNode {
  const [activeTab, setActiveTab] = useState(0);
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [drillLaunched, setDrillLaunched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ progress: { completedModules: string[] } }>('/api/volunteer/tutorial/status', 'volunteer');
        if (res.progress?.completedModules) setCompletedModules(res.progress.completedModules);
      } catch { /* */ }
    })();
  }, []);

  const markModuleDone = async (modId: string) => {
    setBusy(true);
    try {
      await api.post(`/api/volunteer/tutorial/module/${modId}`, {}, 'volunteer');
      setCompletedModules(prev => Array.from(new Set([...prev, modId])));
      if (activeTab < TUTORIAL_MODULES.length - 1) setActiveTab(activeTab + 1);
      onChanged();
    } catch { /* */ }
    finally { setBusy(false); }
  };

  const submitQuiz = async () => {
    setBusy(true);
    setQuizError(null);
    try {
      const res = await api.post<{ score: number; passed: boolean }>('/api/volunteer/tutorial/module/m5_quiz', { answers: quizAnswers }, 'volunteer');
      setQuizScore(res.score);
      setCompletedModules(prev => Array.from(new Set([...prev, 'm5_quiz'])));
      if (activeTab < TUTORIAL_MODULES.length - 1) setActiveTab(activeTab + 1);
      onChanged();
    } catch (err) {
      setQuizError(err instanceof ApiFailure ? (err.error?.message ?? 'Quiz failed. 80% required.') : 'Quiz failed.');
    } finally { setBusy(false); }
  };

  const launchDrill = async () => {
    setBusy(true);
    try {
      await api.post('/api/volunteer/tutorial/practice-alert', {}, 'volunteer');
      setDrillLaunched(true);
      onChanged();
    } catch { /* */ }
    finally { setBusy(false); }
  };

  const currentMod = TUTORIAL_MODULES[activeTab] ?? TUTORIAL_MODULES[0]!;

  return (
    <div className="va-tab">
      <header className="va-tab-header">
        <span className="va-tab-tag">SAFECIRCLE ACADEMY</span>
        <h1>Responder Certification</h1>
      </header>

      {!me.tutorialComplete && (
        <div className="va-notice va-notice-info" style={{ marginBottom: '1rem' }}>
          Complete 6 modules, pass the quiz (80%+), and finish a practice drill to unlock duty.
          <button className="va-btn va-btn-ghost va-btn-sm" style={{ marginTop: '0.5rem' }}
            onClick={() => { void api.post('/api/volunteer/tutorial/complete', {}, 'volunteer').then(onChanged); }}
          >
            Fast Complete (Demo)
          </button>
        </div>
      )}

      {/* Module pills */}
      <div className="va-module-pills">
        {TUTORIAL_MODULES.map((m, idx) => {
          const isDone = completedModules.includes(m.id);
          const isCurrent = idx === activeTab;
          return (
            <button
              key={m.id}
              className={`va-pill ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
              onClick={() => setActiveTab(idx)}
            >
              {isDone ? '✓' : idx + 1}
            </button>
          );
        })}
      </div>

      {/* Module content */}
      <div className="va-card">
        <span className="va-module-badge">MODULE {activeTab + 1} OF 6 · {currentMod.durationMinutes} min</span>
        <h2>{currentMod.title}</h2>
        <p className="va-meta-text" style={{ fontStyle: 'italic' }}>{currentMod.subtitle}</p>
        <p>{currentMod.summary}</p>

        {activeTab < 4 && (
          <div className="va-takeaways">
            <h4>KEY TAKEAWAYS</h4>
            <ul>
              {currentMod.takeaways.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
        )}

        {/* Quiz */}
        {activeTab === 4 && (
          <div className="va-quiz">
            {quizError && <div className="va-error">{quizError}</div>}
            {quizScore !== null && quizScore >= 80 && (
              <div className="va-notice va-notice-good">🎉 Passed with {quizScore}%!</div>
            )}
            {QUIZ_QUESTIONS.map((q, qi) => (
              <div key={q.id} className="va-quiz-q">
                <p className="va-quiz-label">Q{qi + 1}: {q.question}</p>
                {q.options.map((opt, oi) => (
                  <label key={oi} className={`va-quiz-option ${quizAnswers[q.id] === oi ? 'selected' : ''}`}>
                    <input type="radio" name={`q-${q.id}`} checked={quizAnswers[q.id] === oi}
                      onChange={() => setQuizAnswers({ ...quizAnswers, [q.id]: oi })} />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Drill */}
        {activeTab === 5 && (
          <div className="va-drill">
            <div className="va-drill-icon">🚨</div>
            <h3>Live Practice Alert Drill</h3>
            <p>Experience the full emergency flow: alarm, accept, briefing, resolve.</p>
            {drillLaunched ? (
              <div className="va-notice va-notice-good">⚡ Drill dispatched!</div>
            ) : (
              <button className="va-btn va-btn-danger va-btn-block" disabled={busy} onClick={() => void launchDrill()}>
                🚨 Launch Practice Alert
              </button>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="va-module-nav">
        <button className="va-btn va-btn-ghost" disabled={activeTab === 0} onClick={() => setActiveTab(activeTab - 1)}>
          ← Previous
        </button>
        {activeTab < 4 && (
          <button className="va-btn va-btn-primary" disabled={busy} onClick={() => void markModuleDone(currentMod.id)}>
            Complete & Next →
          </button>
        )}
        {activeTab === 4 && (
          <button className="va-btn va-btn-primary" disabled={busy || Object.keys(quizAnswers).length < QUIZ_QUESTIONS.length}
            onClick={() => void submitQuiz()}>
            Submit Quiz
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================ */
/* Profile Tab                                                       */
/* ================================================================ */

function ProfileTab({ me, onSignOut, onChanged }: { me: Me; onSignOut: () => void; onChanged: () => void }): ReactNode {
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rounds, setRounds] = useState<Array<{ id: string; candidateName: string; vouchCount: number }>>([]);

  const [showServerModal, setShowServerModal] = useState(false);

  useEffect(() => {
    if (me.trustLevel >= 2) {
      void (async () => {
        try {
          const res = await api.get<{ rounds: typeof rounds }>('/api/volunteer/voting/rounds', 'volunteer');
          setRounds(res.rounds ?? []);
        } catch { /* */ }
      })();
    }
  }, [me.trustLevel]);

  const requestVerification = async () => {
    setBusy(true);
    try {
      await api.post('/api/volunteer/voting/request', {}, 'volunteer');
      setRequested(true);
      onChanged();
    } catch { /* */ }
    finally { setBusy(false); }
  };

  const vote = async (roundId: string, choice: string) => {
    setBusy(true);
    try {
      await api.post(`/api/volunteer/voting/rounds/${roundId}/vote`, { choice }, 'volunteer');
      setRounds(prev => prev.filter(r => r.id !== roundId));
      onChanged();
    } catch { /* */ }
    finally { setBusy(false); }
  };

  return (
    <div className="va-tab">
      <header className="va-tab-header">
        <h1>Profile</h1>
      </header>

      {/* Profile hero */}
      <div className="va-profile-hero">
        <div className="va-profile-avatar">
          <span>{me.name.charAt(0).toUpperCase()}</span>
        </div>
        <h2>{me.name}</h2>
        <div className="va-profile-badges">
          <span className={`va-badge ${me.trustLevel >= 2 ? 'verified' : 'unverified'}`}>{me.badge}</span>
          {me.skill && <span className="va-badge skill">{me.skill}</span>}
        </div>
        <p className="va-meta-text">
          {me.eligibleForTier1
            ? 'Eligible for Tier 1 "you are closest" alarms.'
            : 'Tier 2 only until verified.'}
        </p>
      </div>

      {/* Community Vouching */}
      <div className="va-card">
        <h3>Community Verification</h3>
        {me.trustLevel < 2 ? (
          <div>
            <p className="va-meta-text">
              Level 1: ID Checked. 3 verified neighbours must vouch for you to become L2.
            </p>
            {requested ? (
              <div className="va-notice va-notice-good">✅ Verification round open! Neighbours invited.</div>
            ) : (
              <button className="va-btn va-btn-primary va-btn-block" disabled={busy} onClick={() => void requestVerification()}>
                Request Community Vouching
              </button>
            )}
          </div>
        ) : (
          <div>
            <p className="va-meta-text">As L2+, you can vouch for other volunteers.</p>
            {rounds.length === 0 ? (
              <p className="va-meta-text" style={{ fontStyle: 'italic' }}>No pending reviews.</p>
            ) : (
              rounds.map(r => (
                <div key={r.id} className="va-vouch-card">
                  <div className="va-vouch-header">
                    <strong>{r.candidateName}</strong>
                    <span>{r.vouchCount}/3 vouches</span>
                  </div>
                  <div className="va-btn-row">
                    <button className="va-btn va-btn-primary va-btn-sm" disabled={busy} onClick={() => void vote(r.id, 'vouch')}>👍 Vouch</button>
                    <button className="va-btn va-btn-ghost va-btn-sm" disabled={busy} onClick={() => void vote(r.id, 'abstain')}>✋ Abstain</button>
                    <button className="va-btn va-btn-danger va-btn-sm" disabled={busy} onClick={() => void vote(r.id, 'concern')}>⚠️ Concern</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Network & Server */}
      <div className="va-card">
        <h3>Network & Server</h3>
        <p className="va-meta-text">
          API Server: <strong>{getApiBaseUrl() || 'Default (local proxy)'}</strong>
        </p>
        <button
          className="va-btn va-btn-ghost va-btn-block"
          style={{ marginTop: '0.5rem' }}
          onClick={() => setShowServerModal(true)}
        >
          ⚙ Change Server IP / Test Connection
        </button>
      </div>

      {showServerModal && <ServerConfigModal onClose={() => setShowServerModal(false)} />}

      {/* Sign out */}
      <button className="va-btn va-btn-ghost va-btn-block" style={{ marginTop: '1rem' }} onClick={onSignOut}>
        Sign Out
      </button>

      <div className="va-reassurance">
        <span>🔒 SafeCircle never shares your personal data</span>
      </div>
    </div>
  );
}
