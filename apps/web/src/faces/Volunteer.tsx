/**
 * Face B: the volunteer app (FR-VOL-1/2/3/4/5/6, FR-BRF-4/5/6).
 *
 * Built around one job: hear the alert, decide in seconds, get there safely,
 * help well. A Tier 1 alert is a full-screen alarm; Tier 2 is a normal card.
 *
 * The screen deliberately shows nothing identifying until Accept is pressed -
 * and the server would refuse to send it anyway (FR-BRF-1).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TUTORIAL_MODULES, QUIZ_QUESTIONS } from '@safecircle/shared';
import {
  api,
  clearToken,
  getToken,
  openSocket,
  ApiFailure,
  type Briefing,
  type CardDto,
  type FlashcardSetDto,
  type PreAcceptAlert,
} from '../lib/api.ts';
import {
  Elapsed,
  ErrorNote,
  HonestyBanner,
  LocationLine,
  SignInPanel,
  SimulatedChip,
  Spinner,
  TierChip,
  usePolling,
} from '../components/common.tsx';
import { MiniMap } from '../components/MiniMap.tsx';

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
  collapse: 'Collapse — possibly not breathing',
  fall: 'Fall',
  child: 'Child',
  cognitive: 'Person with a cognitive disability',
  harassment: 'Harassment or danger',
  fire: 'Fire',
  unknown: 'Unknown',
};

export function Volunteer(): ReactNode {
  const [signedIn, setSignedIn] = useState(() => getToken('volunteer') !== null);

  useEffect(() => {
    const handleUnauthorized = (e: Event) => {
      if ((e as CustomEvent).detail?.role === 'volunteer') {
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
          role="volunteer"
          title="Volunteer sign-in"
          hint={
            <span>
              Demo volunteers: <strong>+919999900101</strong> (Priya N, Verified Nurse),{' '}
              <strong>+919999900102</strong> (Arun M, Verified), <strong>+919999900105</strong>{' '}
              (Sanjay K, unverified — Tier 2 only).
            </span>
          }
          onSignedIn={() => setSignedIn(true)}
        />
      </main>
    );
  }

  return (
    <VolunteerHome
      onSignOut={() => {
        try {
          localStorage.removeItem('safecircle.active_incident.volunteer');
        } catch {
          /* ignore */
        }
        clearToken('volunteer');
        setSignedIn(false);
      }}
    />
  );
}

function VolunteerHome({ onSignOut }: { onSignOut: () => void }): ReactNode {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [activeIncident, setActiveIncident] = useState<string | null>(() => {
    try {
      return localStorage.getItem('safecircle.active_incident.volunteer');
    } catch {
      return null;
    }
  });
  const [liveNudge, setLiveNudge] = useState<string | null>(null);

  const setAndPersistActiveIncident = useCallback((id: string | null) => {
    setActiveIncident(id);
    try {
      if (id) {
        localStorage.setItem('safecircle.active_incident.volunteer', id);
      } else {
        localStorage.removeItem('safecircle.active_incident.volunteer');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/volunteer/me', 'volunteer'));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (error instanceof ApiFailure && error.status === 401) {
      onSignOut();
    }
  }, [error, onSignOut]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const { data: alertData, reload: reloadAlerts } = usePolling(
    () =>
      api.get<{ alerts: PreAcceptAlert[]; activeIncidentId?: string | null }>(
        '/api/volunteer/alerts',
        'volunteer',
      ),
    3000,
  );

  useEffect(() => {
    if (alertData?.activeIncidentId !== undefined) {
      setAndPersistActiveIncident(alertData.activeIncidentId);
    }
  }, [alertData?.activeIncidentId, setAndPersistActiveIncident]);

  // When the Simulator fires a full demo-reset, clear any stale active incident
  // so the volunteer view snaps back to the alert list without needing a page refresh.
  useEffect(() => {
    const handleReset = () => {
      setAndPersistActiveIncident(null);
      reloadAlerts();
    };
    window.addEventListener('safecircle:demo-reset', handleReset);
    return () => window.removeEventListener('safecircle:demo-reset', handleReset);
  }, [setAndPersistActiveIncident, reloadAlerts]);

  /**
   * The push channel. This is a genuine delivery path, not a simulation - but it
   * only works while the app is open, which is exactly why section 10.5 puts a
   * native app on the pilot path.
   */
  useEffect(() => {
    const socket = openSocket('/ws/volunteer', 'volunteer');
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type: string; message?: string };
        if (msg.type === 'alert' || msg.type === 'upgrade') reloadAlerts();
        if (msg.type === 'covered' || msg.type === 'stand_down' || msg.type === 'still_coming') {
          setLiveNudge(msg.message ?? null);
          reloadAlerts();
        }
      } catch {
        /* a malformed frame is not worth breaking the screen over */
      }
    };
    return () => socket.close();
  }, [reloadAlerts]);

  const alerts = alertData?.alerts ?? [];
  const tier1 = alerts.find((a) => a.tier === 1);

  if (activeIncident) {
    return (
      <Mission
        incidentId={activeIncident}
        onDone={() => {
          setAndPersistActiveIncident(null);
          reloadAlerts();
        }}
      />
    );
  }

  return (
    <main className="narrow">
      <HonestyBanner />
      <ErrorNote error={error} />

      {liveNudge && (
        <div className="notice info" role="status">
          {liveNudge}
          <button className="ghost tiny" onClick={() => setLiveNudge(null)} style={{ minHeight: 'auto', padding: '0 0.4rem' }}>
            Dismiss
          </button>
        </div>
      )}

      {me && (
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-deep) 100%)',
            color: '#fff',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem 1.5rem',
            marginBottom: '1rem',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(10, 30, 61, 0.25)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', fontWeight: 700, color: 'var(--teal-light)' }}>
                VOLUNTEER RESPONDER
              </div>
              <h2 style={{ margin: '0.2rem 0', fontFamily: 'var(--font-head)', fontSize: '1.5rem', color: '#fff' }}>
                {me.name}
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                <span className="badge verified" style={{ fontSize: '0.75rem' }}>{me.badge}</span>
                {me.skill && <span className="badge" style={{ fontSize: '0.75rem' }}>{me.skill}</span>}
              </div>
            </div>
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '20px',
                  background: me.availabilityMode === 'off' ? 'rgba(255,255,255,0.1)' : 'rgba(42, 157, 92, 0.25)',
                  border: `1px solid ${me.availabilityMode === 'off' ? 'rgba(255,255,255,0.2)' : 'rgba(42, 157, 92, 0.5)'}`,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                <span style={{ color: me.availabilityMode === 'off' ? '#aaa' : '#4ade80' }}>●</span>
                {me.availabilityMode === 'off' ? 'Offline' : 'Ready for duty'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* A Tier 1 alert takes over the screen: a siren you cannot miss. */}
      {tier1 && (
        <AlertCard
          alert={tier1}
          onResponded={(accepted) => {
            if (accepted) setAndPersistActiveIncident(tier1.incidentId);
            else reloadAlerts();
          }}
        />
      )}

      {alerts
        .filter((a) => a.tier === 2)
        .map((a) => (
          <AlertCard
            key={a.incidentId}
            alert={a}
            onResponded={(accepted) => {
              if (accepted) setAndPersistActiveIncident(a.incidentId);
              else reloadAlerts();
            }}
          />
        ))}

      {alerts.length === 0 && (
        <div className="card center">
          <h2>No alerts right now</h2>
          <p className="muted">You will hear a siren if someone near you needs help.</p>
        </div>
      )}

      {me && <AvailabilityCard me={me} onChanged={() => void loadMe()} />}
      {me && <ProfileCard me={me} onSignOut={onSignOut} onChanged={() => void loadMe()} />}
      {!me && Boolean(error) && (
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <button className="primary" onClick={onSignOut}>
            Sign in again
          </button>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '1.5rem',
          marginTop: '1.75rem',
          padding: '0.75rem 0',
          flexWrap: 'wrap',
          opacity: 0.75,
        }}
      >
        {[
          ['🛡️', '24/7 PROTECTION'],
          ['📍', 'REAL-TIME LOCATION'],
          ['🔒', 'PRIVATE & SECURE'],
        ].map(([icon, label]) => (
          <div key={label} style={{ textAlign: 'center', minWidth: '85px' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '0.2rem' }}>{icon}</div>
            <div
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.07em',
                fontFamily: 'var(--font-head)',
                color: 'var(--muted)',
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

/** The alert screen. Slide-to-accept prevents a pocket accept (FR-VOL-1). */
function AlertCard({
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

  const respond = async (response: 'accepted' | 'declined', reason?: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/api/incidents/${alert.incidentId}/respond`,
        { response, reason },
        'volunteer',
      );
      onResponded(response === 'accepted');
    } catch (err) {
      setError(err);
      setSlide(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={alert.tier === 1 ? 'alarm' : 'alert-normal'}>
      <div className="btnrow" style={{ marginBottom: '0.4rem' }}>
        <TierChip tier={alert.tier} />
        {alert.isDrill && <span className="chip drill">DRILL</span>}
        {alert.stealth && <span className="chip demo">ARRIVE QUIETLY</span>}
      </div>

      <h2>{alert.tier === 1 ? 'You are the closest helper' : 'Help needed nearby'}</h2>

      <div className="meta">
        <div>
          Situation
          <strong>{CASE_LABELS[alert.category] ?? alert.category}</strong>
        </div>
        <div>
          Distance
          <strong>about {alert.distanceBandM} m</strong>
        </div>
        <div>
          On foot
          <strong>about {Math.max(1, Math.round(alert.etaS / 60))} min</strong>
        </div>
        <div>
          Person
          <strong>age {alert.ageBand}</strong>
        </div>
      </div>

      <p className={alert.tier === 1 ? '' : 'muted small'}>
        {alert.respondersSoFar === 0
          ? 'Nobody has accepted yet.'
          : `${alert.respondersSoFar} already responding.`}
      </p>

      {/* FR-VOL-4: the safety check must be acknowledged before accepting. */}
      {alert.safetyNotice && (
        <div className="notice safety" role="alert">
          <div>
            {alert.safetyNotice}
            <label style={{ marginTop: '0.5rem', fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={acknowledgedSafety}
                onChange={(e) => setAcknowledgedSafety(e.target.checked)}
                style={{ width: 'auto', minHeight: 'auto', marginRight: '0.45rem' }}
              />
              I understand and will not confront anyone
            </label>
          </div>
        </div>
      )}

      <ErrorNote error={error} />

      {!declining ? (
        <>
          <label htmlFor={`slide-${alert.incidentId}`} style={{ marginTop: '0.8rem' }}>
            Slide all the way across to accept
          </label>
          <input
            id={`slide-${alert.incidentId}`}
            type="range"
            min={0}
            max={100}
            value={slide}
            onChange={(e) => setSlide(Number(e.target.value))}
            aria-describedby={`slidehint-${alert.incidentId}`}
          />
          <p id={`slidehint-${alert.incidentId}`} className="tiny" style={{ opacity: 0.85 }}>
            A slider rather than a button, so the alert cannot be accepted by accident in a pocket.
          </p>
          <div className="btnrow">
            <button
              className={alert.tier === 1 ? 'accept big' : 'primary big'}
              disabled={!canAccept || busy}
              onClick={() => void respond('accepted')}
            >
              {canAccept ? 'Accept and go' : 'Slide to accept'}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setDeclining(true)}>
              Can't go
            </button>
          </div>
        </>
      ) : (
        <div className="stack" style={{ marginTop: '0.7rem' }}>
          <p>
            <strong>Why not?</strong> This helps dispatch learn, and it is never shown to the person.
          </p>
          <div className="btnrow">
            {(
              [
                ['too_far', 'Too far'],
                ['busy', 'Busy'],
                ['not_safe', 'Not safe'],
                ['not_trained', 'Not trained for this'],
              ] as const
            ).map(([reason, label]) => (
              <button key={reason} disabled={busy} onClick={() => void respond('declined', reason)}>
                {label}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={() => setDeclining(false)}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}

/** The mission screen after accepting (FR-VOL-5, FR-BRF-4/5/6). */
function Mission({ incidentId, onDone }: { incidentId: string; onDone: () => void }): ReactNode {
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
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        setBriefing(await api.get<Briefing>(`/api/incidents/${incidentId}/briefing`, 'volunteer'));
        setCards(await api.get<FlashcardSetDto>(`/api/incidents/${incidentId}/flashcards`, 'volunteer'));
      } catch (err) {
        // If the incident is closed or reset (403 briefing_not_authorised, or 404
        // incident_closed) then the localStorage entry is stale.  Auto-dismiss so
        // the volunteer lands back on the alert list immediately instead of being
        // stuck on a broken Mission screen.
        if (err instanceof ApiFailure && (err.status === 403 || err.status === 404)) {
          onDone();
          return;
        }
        setError(err);
      }
    })();
  }, [incidentId, onDone]);

  /** Live position while en route, which stops the moment they arrive (L4). */
  useEffect(() => {
    if (status !== 'en_route' && status !== 'accepted') return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        void api
          .post(
            '/api/volunteer/location',
            {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy,
              incident_id: incidentId,
            },
            'volunteer',
          )
          .catch(() => {
            /* a dropped fix is not worth interrupting the responder */
          });
      },
      () => {
        /* permission refused: the mission still works, the ETA is just coarser */
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [incidentId, status]);

  const openCardByKey = async (key: string): Promise<void> => {
    try {
      setOpenCard(await api.get<CardDto>(`/api/cards/${key}`, 'volunteer'));
    } catch (err) {
      setError(err);
    }
  };

  const chooseCard = async (key: string): Promise<void> => {
    setChosen(key);
    await openCardByKey(key);
    try {
      await api.post(`/api/incidents/${incidentId}/card-selection`, { card_key: key }, 'volunteer');
    } catch (err) {
      setError(err);
    }
  };

  const tapStatus = async (next: string, note?: string): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; state?: string }>(
        `/api/incidents/${incidentId}/status`,
        { status: next, note },
        'volunteer',
      );
      setStatus(res.state ?? next);
      if (next === 'resolved' || next === 'handed_to_ambulance' || next === 'cant_attend') onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error && !briefing) {
    return (
      <main className="narrow">
        <ErrorNote error={error} />
        <button onClick={onDone}>Back to alerts</button>
      </main>
    );
  }
  if (!briefing) return <main className="narrow"><Spinner label="Opening the briefing" /></main>;

  return (
    <main className="narrow">
      {briefing.isDrill && (
        <div className="notice info" role="note">
          <strong>This is a drill.</strong> Nobody actually needs help.
        </div>
      )}

      <div className="notice safety" role="note">
        {cards?.safetyLine ?? 'Check for danger before you go in.'}
      </div>

      {/* FR-BRF-4: the handling banner goes above everything else. */}
      {briefing.handlingBanner.length > 0 && (
        <div className="notice info" role="note">
          <div>
            <strong>How to approach them</strong>
            <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
              {briefing.handlingBanner.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card">
        <h2>
          {briefing.person.name}
          {briefing.person.respondsToName && (
            <span className="muted small"> — answers to “{briefing.person.respondsToName}”</span>
          )}
        </h2>
        <p className="small">
          Age {briefing.person.ageBand} · speaks {briefing.person.languages.join(', ')}
        </p>
        <p>
          <strong>{[briefing.flat, briefing.address].filter(Boolean).join(', ')}</strong>
          {briefing.landmark && <span className="muted"> · {briefing.landmark}</span>}
        </p>
        <p className="small">
          <LocationLine location={briefing.location} />
        </p>
        <MiniMap
          center={[briefing.location.lat, briefing.location.lng]}
          accuracyM={briefing.location.accuracyM}
          label={briefing.person.name}
        />

        {briefing.accessSecrets && (
          <div className="notice info" style={{ marginTop: '0.7rem' }}>
            <div>
              <strong>Access (guard only)</strong>
              <br />
              {briefing.accessSecrets.gateCode && <>Gate code {briefing.accessSecrets.gateCode}. </>}
              {briefing.accessSecrets.doorCode && <>Door code {briefing.accessSecrets.doorCode}. </>}
              {briefing.accessSecrets.spareKeyHolder && (
                <>Spare key: {briefing.accessSecrets.spareKeyHolder}.</>
              )}
            </div>
          </div>
        )}

        {briefing.health && (
          <details style={{ marginTop: '0.7rem' }}>
            <summary><strong>Medical notes</strong></summary>
            <ul className="small" style={{ paddingLeft: '1.2rem' }}>
              {briefing.health.conditions?.length ? <li>Conditions: {briefing.health.conditions.join(', ')}</li> : null}
              {briefing.health.medicines?.length ? <li>Medicines: {briefing.health.medicines.join(', ')}</li> : null}
              {briefing.health.allergies?.length ? <li>Allergies: {briefing.health.allergies.join(', ')}</li> : null}
              {briefing.health.bloodGroup ? <li>Blood group: {briefing.health.bloodGroup}</li> : null}
              {briefing.health.mobilityAids?.length ? <li>Mobility aids: {briefing.health.mobilityAids.join(', ')}</li> : null}
              {briefing.health.doctor ? <li>Doctor: {briefing.health.doctor}</li> : null}
            </ul>
          </details>
        )}
      </div>

      {/* FR-BRF-5: three likely situations, with CPR always on screen. */}
      {cards && (
        <div className="card">
          <h3>What will you most likely find?</h3>
          <p className="muted small">{cards.disclaimer}</p>
          <div className="cardchips">
            {cards.likely.map((c) => (
              <button
                key={c.key}
                className="cardchip"
                aria-pressed={chosen === c.key}
                onClick={() => void chooseCard(c.key)}
              >
                {c.title}
                <span className="why">{c.because[0]}</span>
              </button>
            ))}
          </div>
          <button
            className="cardchip cpr block"
            style={{ marginTop: '0.6rem' }}
            onClick={() => void chooseCard(cards.alwaysVisible.key)}
          >
            Not breathing or unresponsive? Start CPR
          </button>
          <details style={{ marginTop: '0.7rem' }}>
            <summary>Something else</summary>
            <div className="btnrow" style={{ marginTop: '0.5rem' }}>
              {([
                ['unconscious_breathing', 'Unconscious but breathing'],
                ['severe_bleeding', 'Bleeding'],
                ['chest_pain', 'Chest pain'],
                ['choking', 'Choking'],
                ['seizure', 'Having a fit'],
                ['low_blood_sugar', 'Confused'],
                ['fall_older_person', 'Fell over'],
                ['panic_attack', 'Scared or upset'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => void chooseCard(key)}>
                  {label}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}

      {openCard && <CardPanel card={openCard} onClose={() => setOpenCard(null)} />}

      {/* F23: "I'm in danger" — volunteer's own emergency trigger */}
      <div
        className="card"
        style={{
          border: '2px solid rgba(211, 47, 47, 0.45)',
          background: dangerSent
            ? 'linear-gradient(135deg, rgba(211, 47, 47, 0.15) 0%, rgba(143, 29, 33, 0.2) 100%)'
            : 'linear-gradient(135deg, rgba(211, 47, 47, 0.05) 0%, rgba(143, 29, 33, 0.08) 100%)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: dangerSent ? '0 0 20px rgba(211, 47, 47, 0.25)' : undefined,
        }}
      >
        {dangerSent ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.8rem' }}>🚨</span>
            <div>
              <strong style={{ color: 'var(--red)', fontSize: '1.05rem', display: 'block' }}>
                Emergency SOS Broadcasted (P1)
              </strong>
              <span className="small" style={{ color: 'var(--ink)' }}>
                Control room, co-responders, and emergency services (112) have been alerted to your position. Keep yourself safe.
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                  color: 'var(--red)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '1.05rem',
                }}
              >
                <span>⚠️</span> Responder Safety
              </h3>
              <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
                Threat, violence, or feel unsafe on scene? Trigger your own emergency SOS.
              </p>
            </div>
            {!dangerConfirm ? (
              <button
                className="danger"
                disabled={busy}
                onClick={() => setDangerConfirm(true)}
                style={{
                  fontWeight: 700,
                  padding: '0.6rem 1.25rem',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                🚨 I'm in danger
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => void reportDanger()}
                  style={{
                    fontWeight: 800,
                    padding: '0.6rem 1.25rem',
                    borderRadius: '12px',
                    boxShadow: '0 0 14px rgba(211, 47, 47, 0.6)',
                  }}
                >
                  Confirm: Alert 112 & Desk
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => setDangerConfirm(false)}
                  style={{ borderRadius: '12px' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Status</h3>
        <div className="btnrow">
          <button className="primary" disabled={busy} onClick={() => void tapStatus('on_my_way')}>
            On my way
          </button>
          <button className="primary" disabled={busy} onClick={() => void tapStatus('arrived')}>
            Arrived
          </button>
          <button className="warn" disabled={busy} onClick={() => void tapStatus('need_backup')}>
            Need backup
          </button>
          <button disabled={busy} onClick={() => void tapStatus('handed_to_ambulance')}>
            Handed to ambulance
          </button>
          <button disabled={busy} onClick={() => void tapStatus('resolved')}>
            Resolved — helped
          </button>
          <button disabled={busy} onClick={() => void tapStatus('resolved', 'no_help_needed')}>
            Resolved — no help needed
          </button>
          <button className="danger ghost" disabled={busy} onClick={() => void tapStatus('cant_attend')}>
            Can't attend after all
          </button>
        </div>
        <p className="hint">Current state: {status.replace(/_/g, ' ')}</p>
      </div>

      <div className="card">
        <h3>Contact</h3>
        <p className="small muted">
          Calls go through number masking, so neither side sees the other's personal number.{' '}
          <SimulatedChip what="masked calling" />
        </p>
        <div className="btnrow">
          <button disabled>Call family {briefing.familyContactMasked}</button>
          <button disabled>Call guard {briefing.guardContactMasked}</button>
          <button className="danger">Call 112</button>
        </div>
      </div>

      <ErrorNote error={error} />
      <button className="ghost block" onClick={onDone} style={{ marginTop: '1rem' }}>
        Back to alerts
      </button>
    </main>
  );
}

function CardPanel({ card, onClose }: { card: CardDto; onClose: () => void }): ReactNode {
  return (
    <div className="card" style={{ borderColor: 'var(--teal)', borderWidth: 2 }}>
      <div className="btnrow" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{card.title}</h3>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="notice info small" style={{ marginTop: '0.5rem' }}>
        {card.disclaimer} Source: {card.source}.
        {card.reviewedBy?.startsWith('PLACEHOLDER') && (
          <>
            {' '}
            <strong>This card has not yet been reviewed by a named doctor.</strong>
          </>
        )}
      </p>

      {card.body.whatToCheck.length > 0 && (
        <>
          <h4>Check</h4>
          <ul className="steps">
            {card.body.whatToCheck.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      <h4>Do this</h4>
      <ol className="steps">
        {card.body.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <h4 style={{ color: 'var(--red-deep)' }}>Do not</h4>
      <ul className="steps donot">
        {card.body.doNot.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <h4>Call 112 if</h4>
      <ul className="steps">
        {card.body.whenToCall112.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <h4>Tell the ambulance crew</h4>
      <ul className="steps">
        {card.body.tellTheCrew.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {card.key === 'cpr_hands_only' && <Metronome />}
    </div>
  );
}

/** The CPR metronome: 110 beats a minute, inside the 100-120 range. */
function Metronome(): ReactNode {
  const [on, setOn] = useState(false);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!on) return;
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const interval = setInterval(() => {
      setBeat((b) => b + 1);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    }, 60_000 / 110);
    return () => {
      clearInterval(interval);
      void ctx.close();
    };
  }, [on]);

  return (
    <div className="notice good" style={{ marginTop: '0.7rem' }}>
      <div>
        <strong>Compression metronome — 110 a minute</strong>
        <div className="btnrow" style={{ marginTop: '0.4rem' }}>
          <button className={on ? 'danger' : 'primary'} onClick={() => setOn(!on)}>
            {on ? 'Stop' : 'Start metronome'}
          </button>
          {on && <span aria-live="polite">{beat} compressions</span>}
        </div>
      </div>
    </div>
  );
}

function AvailabilityCard({ me, onChanged }: { me: Me; onChanged: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const on = me.availabilityMode !== 'off';

  const set = async (mode: string, until?: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/volunteer/availability', { mode, until }, 'volunteer');
      // Report the current zone, so ranking has something fresh to work with.
      if (mode !== 'off' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            void api
              .post('/api/volunteer/location', { lat: pos.coords.latitude, lng: pos.coords.longitude }, 'volunteer')
              .catch(() => {});
          },
          () => {},
        );
      }
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const [showAcademy, setShowAcademy] = useState(false);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Availability & Duty</h3>
        <button
          className="ghost tiny"
          onClick={() => setShowAcademy(true)}
          style={{ fontSize: '0.75rem', fontWeight: 600 }}
        >
          🎓 {me.tutorialComplete ? 'Review Academy' : 'Academy & Drill'}
        </button>
      </div>

      <ErrorNote error={error} />

      {!me.tutorialComplete && (
        <div
          className="notice info"
          style={{
            background: 'rgba(10, 30, 61, 0.08)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '1.2rem' }}>🎓</span>
            <strong style={{ fontSize: '0.9rem' }}>Mandatory Academy & Practice Drill</strong>
          </div>
          <p style={{ margin: '0 0 0.6rem 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Complete the 6 core modules, score 80%+ on the safety check, and complete a live simulated alert before going available.
          </p>
          <div className="btnrow">
            <button
              className="primary"
              onClick={() => setShowAcademy(true)}
              style={{ fontWeight: 700 }}
            >
              Start Academy Modules (M1–M6)
            </button>
            <button
              className="ghost tiny"
              disabled={busy}
              onClick={() => {
                void api.post('/api/volunteer/tutorial/complete', {}, 'volunteer').then(onChanged);
              }}
            >
              Fast Complete (Demo)
            </button>
          </div>
        </div>
      )}

      {showAcademy && (
        <TutorialAcademyModal
          onClose={() => setShowAcademy(false)}
          onCompleted={() => {
            onChanged();
          }}
        />
      )}

      <button
        className={on ? 'danger block big' : 'primary block big'}
        disabled={busy || !me.tutorialComplete}
        onClick={() => void set(on ? 'off' : 'available_now')}
        aria-pressed={on}
      >
        {on ? 'Available — tap to stop' : 'Go available'}
      </button>

      <div className="btnrow" style={{ marginTop: '0.5rem' }}>
        <button
          disabled={busy || !me.tutorialComplete}
          onClick={() => void set('available_until', new Date(Date.now() + 4 * 3600_000).toISOString())}
        >
          Available for 4 hours
        </button>
        <button disabled={busy || !me.tutorialComplete} onClick={() => void set('home_only')}>
          Only when I'm at home
        </button>
      </div>

      <p className="hint">
        While available, SafeCircle checks your approximate area about once an hour and your exact
        location only when someone near you needs help. Live tracking runs only after you accept, and
        stops when you arrive.
      </p>
      <p className="hint">
        <SimulatedChip what="battery-aware wake-up push" /> This web app can only read your location
        while it is open. The pilot's native app uses the wake-up design instead.
      </p>
    </div>
  );
}

/** Academy modal for F28: M1-M6, Quiz with 80% pass mark, and practice drill alert. */
function TutorialAcademyModal({
  onClose,
  onCompleted,
}: {
  onClose: () => void;
  onCompleted: () => void;
}): ReactNode {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [drillLaunched, setDrillLaunched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{
          progress: { completedModules: string[]; scores: Record<string, number>; isComplete: boolean };
        }>('/api/volunteer/tutorial/status', 'volunteer');
        if (res.progress?.completedModules) {
          setCompletedModules(res.progress.completedModules);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const markModuleDone = async (modId: string) => {
    setBusy(true);
    try {
      await api.post(`/api/volunteer/tutorial/module/${modId}`, {}, 'volunteer');
      setCompletedModules((prev) => Array.from(new Set([...prev, modId])));
      if (activeTab < TUTORIAL_MODULES.length - 1) {
        setActiveTab(activeTab + 1);
      }
      onCompleted();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const submitQuiz = async () => {
    setBusy(true);
    setQuizError(null);
    try {
      const res = await api.post<{ ok: boolean; score: number; passed: boolean; allDone: boolean; message?: string }>(
        '/api/volunteer/tutorial/module/m5_quiz',
        { answers: quizAnswers },
        'volunteer',
      );
      setQuizScore(res.score);
      setCompletedModules((prev) => Array.from(new Set([...prev, 'm5_quiz'])));
      if (activeTab < TUTORIAL_MODULES.length - 1) {
        setActiveTab(activeTab + 1);
      }
      onCompleted();
    } catch (err) {
      if (err instanceof ApiFailure) {
        setQuizError(err.error?.message ?? err.message ?? 'Quiz failed. 80% passing grade required.');
      } else {
        setQuizError('Quiz grading failed. Please review your answers.');
      }
    } finally {
      setBusy(false);
    }
  };

  const launchPracticeDrill = async () => {
    setBusy(true);
    try {
      await api.post('/api/volunteer/tutorial/practice-alert', {}, 'volunteer');
      setDrillLaunched(true);
      onCompleted();
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const currentMod = (TUTORIAL_MODULES[activeTab] || TUTORIAL_MODULES[0])!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(5px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          padding: '1.75rem',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', fontWeight: 700, color: 'var(--teal)' }}>
              SAFECIRCLE ACADEMY
            </span>
            <h2 style={{ margin: '0.1rem 0', fontSize: '1.4rem' }}>Responder Certification</h2>
          </div>
          <button className="ghost tiny" onClick={onClose} style={{ fontSize: '1.2rem', padding: '0.2rem 0.6rem' }}>
            ✕
          </button>
        </div>

        {/* Progress pills */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {TUTORIAL_MODULES.map((m, idx) => {
            const isDone = completedModules.includes(m.id);
            const isCurrent = idx === activeTab;
            return (
              <button
                key={m.id}
                onClick={() => setActiveTab(idx)}
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.76rem',
                  borderRadius: '20px',
                  fontWeight: 600,
                  border: isCurrent ? '2px solid var(--teal)' : '1px solid var(--border)',
                  background: isDone ? 'rgba(42, 157, 92, 0.15)' : isCurrent ? 'var(--surface-hover)' : 'transparent',
                  color: isDone ? '#2a9d5c' : isCurrent ? 'var(--teal)' : 'var(--text-muted)',
                }}
              >
                {isDone ? '✓ ' : `${idx + 1}. `}{m.title.split(' ')[0]}
              </button>
            );
          })}
        </div>

        {/* Module Content */}
        <div style={{ minHeight: '260px', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div>
              <span className="badge" style={{ fontSize: '0.7rem' }}>MODULE {activeTab + 1} OF 6</span>
              <h3 style={{ margin: '0.4rem 0 0.2rem 0', fontSize: '1.25rem' }}>{currentMod.title}</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {currentMod.subtitle}
              </p>
            </div>
            <span style={{ fontSize: '0.75rem', opacity: 0.7, padding: '0.2rem 0.5rem', background: 'var(--bg-light)', borderRadius: '4px' }}>
              ⏱ {currentMod.durationMinutes} min
            </span>
          </div>

          <p style={{ margin: '1rem 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
            {currentMod.summary}
          </p>

          {/* M1 - M4: Takeaways */}
          {activeTab < 4 && (
            <div style={{ background: 'var(--bg-light)', padding: '1rem', borderRadius: 'var(--radius)', marginTop: '0.8rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                KEY TAKEAWAYS FOR SCENE ACTION:
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', lineHeight: 1.6 }}>
                {currentMod.takeaways.map((item, i) => (
                  <li key={i} style={{ marginBottom: '0.35rem' }}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* M5: Quiz */}
          {activeTab === 4 && (
            <div style={{ marginTop: '1rem' }}>
              {quizError && <div className="notice warn" style={{ marginBottom: '1rem' }}>{quizError}</div>}
              {quizScore !== null && quizScore >= 80 && (
                <div className="notice good" style={{ marginBottom: '1rem' }}>
                  🎉 Passed! You scored {quizScore}%. Module 6 (Practice Alert Drill) is now unlocked!
                </div>
              )}
              {QUIZ_QUESTIONS.map((q, qIndex) => (
                <div key={q.id} style={{ marginBottom: '1.25rem', padding: '0.85rem', background: 'var(--bg-light)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.6rem' }}>
                    Q{qIndex + 1}: {q.question}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {q.options.map((opt, oIndex) => {
                      const selected = quizAnswers[q.id] === oIndex;
                      return (
                        <label
                          key={oIndex}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.45rem 0.65rem',
                            borderRadius: 'var(--radius)',
                            background: selected ? 'rgba(10, 30, 61, 0.1)' : 'transparent',
                            border: `1px solid ${selected ? 'var(--teal)' : 'var(--border)'}`,
                            cursor: 'pointer',
                            fontSize: '0.82rem',
                          }}
                        >
                          <input
                            type="radio"
                            name={`quiz-${q.id}`}
                            checked={selected}
                            onChange={() => setQuizAnswers({ ...quizAnswers, [q.id]: oIndex })}
                            style={{ margin: 0 }}
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* M6: Practice Drill */}
          {activeTab === 5 && (
            <div style={{ marginTop: '1rem' }}>
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.05) 100%)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-lg)',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem' }}>🚨</span>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem', color: 'var(--red-deep)' }}>
                  Live Practice Alert Drill
                </h4>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Trigger a live practice alert to your screen. You will experience the full emergency alarm:
                  audible siren, concentric pulsing rings, sliding to accept, medical briefing, and marking resolved.
                </p>
                {drillLaunched ? (
                  <div className="notice good" style={{ fontWeight: 700 }}>
                    ⚡ Drill alert dispatched! Returning to main alert screen...
                  </div>
                ) : (
                  <button
                    className="danger big"
                    disabled={busy}
                    onClick={() => void launchPracticeDrill()}
                    style={{ fontWeight: 700, padding: '0.75rem 1.5rem', fontSize: '1rem' }}
                  >
                    🚨 Launch Practice Alert
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal footer navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <button
            className="ghost"
            disabled={activeTab === 0}
            onClick={() => setActiveTab(activeTab - 1)}
          >
            ← Previous
          </button>

          {activeTab < 4 && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void markModuleDone(currentMod.id)}
            >
              Complete & Next →
            </button>
          )}

          {activeTab === 4 && (
            <button
              className="primary"
              disabled={busy || Object.keys(quizAnswers).length < QUIZ_QUESTIONS.length}
              onClick={() => void submitQuiz()}
            >
              Submit Quiz Check
            </button>
          )}

          {activeTab === 5 && (
            <button className="ghost" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Community Vouching and Verification Panel (F26). */
function CommunityVouchingCard({
  me,
  onChanged,
}: {
  me: Me;
  onChanged: () => void;
}): ReactNode {
  const [rounds, setRounds] = useState<Array<{
    id: string; candidateId: string; candidateName: string; status: string; deadlineAt: string; vouchCount: number; concernCount: number;
  }>>([]);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (me.trustLevel >= 2) {
      void (async () => {
        try {
          const res = await api.get<{ rounds: typeof rounds }>('/api/volunteer/voting/rounds', 'volunteer');
          setRounds(res.rounds ?? []);
        } catch {
          /* ignore */
        }
      })();
    }
  }, [me.trustLevel]);

  const requestVerification = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/volunteer/voting/request', {}, 'volunteer');
      setRequested(true);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const vote = async (roundId: string, choice: 'vouch' | 'concern' | 'abstain') => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/volunteer/voting/rounds/${roundId}/vote`, { choice }, 'volunteer');
      setRounds((prev) => prev.filter((r) => r.id !== roundId));
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Community Verification (F26)</h3>
        <span className={`chip ${me.trustLevel >= 2 ? 'verified' : 'unverified'}`}>
          {me.badge} (L{me.trustLevel})
        </span>
      </div>

      <ErrorNote error={error} />

      {me.trustLevel < 2 ? (
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.8rem 0' }}>
            Level 1: ID Checked. To become an L2 Verified Responder and qualify for Tier 1 closest alerts,
            3 verified neighbours in your society must vouch for you without leaking personal records.
          </p>
          {requested ? (
            <div className="notice good">
              ✅ Verification round is open! Verified neighbours within 1 km have been invited to vouch for you.
            </div>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void requestVerification()}
            >
              Request Community Vouching
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.8rem 0' }}>
            As an L2 Verified volunteer, you participate in society peer-review to endorse new volunteer candidates.
          </p>

          {rounds.length === 0 ? (
            <p className="tiny muted" style={{ fontStyle: 'italic', margin: 0 }}>
              No pending neighbour verification ballots in your society right now.
            </p>
          ) : (
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.4rem', color: 'var(--teal)' }}>
                PENDING NEIGHBOUR REVIEWS ({rounds.length})
              </div>
              {rounds.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--bg-light)',
                    borderRadius: 'var(--radius)',
                    marginBottom: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <strong>{r.candidateName}</strong>
                    <span className="tiny muted">{r.vouchCount} / 3 vouches</span>
                  </div>
                  <div className="btnrow">
                    <button
                      className="primary tiny"
                      disabled={busy}
                      onClick={() => void vote(r.id, 'vouch')}
                    >
                      👍 Vouch
                    </button>
                    <button
                      className="ghost tiny"
                      disabled={busy}
                      onClick={() => void vote(r.id, 'abstain')}
                    >
                      ✋ Abstain
                    </button>
                    <button
                      className="danger ghost tiny"
                      disabled={busy}
                      onClick={() => void vote(r.id, 'concern')}
                    >
                      ⚠️ Concern
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileCard({
  me,
  onSignOut,
  onChanged,
}: {
  me: Me;
  onSignOut: () => void;
  onChanged: () => void;
}): ReactNode {
  return (
    <>
      <div className="card">
        <h3>{me.name}</h3>
        <div className="btnrow">
          <span className={`chip ${me.trustLevel >= 2 ? 'verified' : 'unverified'}`}>{me.badge}</span>
          {me.skill && <span className="chip ok">{me.skill}</span>}
        </div>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          {me.eligibleForTier1
            ? 'You are eligible for Tier 1 "you are closest" alarms.'
            : 'Tier 2 only until you are verified. You can never be the only responder for a child or a person with a cognitive disability.'}
        </p>
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <CommunityVouchingCard me={me} onChanged={onChanged} />
    </>
  );
}

