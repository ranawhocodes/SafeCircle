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
import {
  api,
  clearToken,
  getToken,
  openSocket,
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
  return <VolunteerHome onSignOut={() => { clearToken('volunteer'); setSignedIn(false); }} />;
}

function VolunteerHome({ onSignOut }: { onSignOut: () => void }): ReactNode {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [activeIncident, setActiveIncident] = useState<string | null>(null);
  const [liveNudge, setLiveNudge] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/volunteer/me', 'volunteer'));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const { data: alertData, reload: reloadAlerts } = usePolling(
    () => api.get<{ alerts: PreAcceptAlert[] }>('/api/volunteer/alerts', 'volunteer'),
    3000,
  );

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
          setActiveIncident(null);
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

      {/* A Tier 1 alert takes over the screen: a siren you cannot miss. */}
      {tier1 && (
        <AlertCard
          alert={tier1}
          onResponded={(accepted) => {
            if (accepted) setActiveIncident(tier1.incidentId);
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
              if (accepted) setActiveIncident(a.incidentId);
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

  useEffect(() => {
    void (async () => {
      try {
        setBriefing(await api.get<Briefing>(`/api/incidents/${incidentId}/briefing`, 'volunteer'));
        setCards(await api.get<FlashcardSetDto>(`/api/incidents/${incidentId}/flashcards`, 'volunteer'));
      } catch (err) {
        setError(err);
      }
    })();
  }, [incidentId]);

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

  return (
    <div className="card">
      <h3>I am available</h3>
      <ErrorNote error={error} />
      {!me.tutorialComplete && (
        <div className="notice info">
          Finish the short tutorial and a practice alert before going available.
          <button
            className="primary"
            style={{ marginLeft: '0.5rem' }}
            disabled={busy}
            onClick={() => {
              void api.post('/api/volunteer/tutorial/complete', {}, 'volunteer').then(onChanged);
            }}
          >
            Mark tutorial complete
          </button>
        </div>
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

function ProfileCard({
  me,
  onSignOut,
}: {
  me: Me;
  onSignOut: () => void;
  onChanged: () => void;
}): ReactNode {
  return (
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
  );
}
