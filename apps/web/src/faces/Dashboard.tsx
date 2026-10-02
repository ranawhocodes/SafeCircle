/**
 * Guard desk and authority dashboard (FR-FAM-5..8).
 *
 * Also the demo control surface: the verification outcome buttons are how a
 * presenter drives the simulated IVR on stage (section 22.1, scene 3).
 */
import { useState, type ReactNode } from 'react';
import {
  api,
  clearToken,
  getToken,
  type DashboardDetail,
  type DashboardIncident,
} from '../lib/api.ts';
import {
  Clock,
  Elapsed,
  ErrorNote,
  HonestyBanner,
  LocationLine,
  SeverityChip,
  SignInPanel,
  SimulatedChip,
  Spinner,
  usePolling,
} from '../components/common.tsx';
import { MiniMap } from '../components/MiniMap.tsx';

export function Dashboard(): ReactNode {
  const [signedIn, setSignedIn] = useState(() => getToken('dashboard') !== null);
  const [selected, setSelected] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <main>
        <HonestyBanner />
        <SignInPanel
          role="dashboard"
          title="Control room / society desk sign-in"
          hint={
            <span>
              Any registered number works for the desk in this build. Try the guard's number{' '}
              <strong>+919999900001</strong>.
            </span>
          }
          onSignedIn={() => setSignedIn(true)}
        />
      </main>
    );
  }

  return (
    <main>
      <HonestyBanner />
      {selected ? (
        <IncidentDetail id={selected} onBack={() => setSelected(null)} />
      ) : (
        <IncidentList onOpen={setSelected} onSignOut={() => { clearToken('dashboard'); setSignedIn(false); }} />
      )}
    </main>
  );
}

function IncidentList({
  onOpen,
  onSignOut,
}: {
  onOpen: (id: string) => void;
  onSignOut: () => void;
}): ReactNode {
  const { data, error } = usePolling(
    () => api.get<{ incidents: DashboardIncident[] }>('/api/dashboard/incidents', 'dashboard'),
    2000,
  );
  const kpis = usePolling(() => api.get<Record<string, unknown>>('/api/dashboard/kpis', 'dashboard'), 15_000);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading incidents" />;

  const open = data.incidents.filter((i) => i.closedAt === null);
  const closed = data.incidents.filter((i) => i.closedAt !== null);

  return (
    <>
      <div className="btnrow" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>
          Live incidents <span className="muted">({open.length} open)</span>
        </h1>
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      {open.length === 0 && (
        <div className="card center">
          <p className="muted">No open incidents. The desk alarm will sound when one arrives.</p>
        </div>
      )}

      {open.map((i) => (
        <IncidentRow key={i.id} incident={i} onOpen={onOpen} />
      ))}

      {kpis.data && (
        <div className="card">
          <h2>Pilot KPIs</h2>
          <p className="muted small">{String(kpis.data.note)}</p>
          <div className="table-wrap">
            <table>
              <tbody>
                <Kpi
                  label="Press to first volunteer alert (median)"
                  value={fmt(kpis.data.pressToFirstAlertMedianS, 's')}
                  target={`under ${String(kpis.data.pressToFirstAlertTargetS)} s`}
                />
                <Kpi
                  label="First accept within 60 s"
                  value={fmt(kpis.data.firstAcceptWithin60Pct, '%')}
                  target={`${String(kpis.data.firstAcceptWithin60TargetPct)}% of drills`}
                />
                <Kpi
                  label="Dispatch location accuracy (median)"
                  value={fmt(kpis.data.dispatchLocationAccuracyMedianM, 'm')}
                  target={`under ${String(kpis.data.dispatchLocationAccuracyTargetM)} m`}
                />
                <Kpi
                  label="False alarms caught by cancel verification"
                  value={String(kpis.data.falseAlarmsCaughtByVerification)}
                  target="tracked"
                />
                <Kpi
                  label="Possible-duress incidents"
                  value={String(kpis.data.possibleDuressIncidents)}
                  target="tracked"
                />
                <Kpi
                  label="Devices silent over 24 h"
                  value={String(kpis.data.devicesSilentOver24h)}
                  target="under 2% of devices"
                />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <details className="card">
          <summary>
            <strong>Closed incidents ({closed.length})</strong>
          </summary>
          <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Opened</th>
                  <th>Person</th>
                  <th>Severity</th>
                  <th>Outcome</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {closed.map((i) => (
                  <tr key={i.id}>
                    <td><Clock at={i.openedAt} /></td>
                    <td>{i.person?.name ?? <span className="muted">Unknown sender</span>}</td>
                    <td><SeverityChip severity={i.severity} /></td>
                    <td>{i.outcome?.replace(/_/g, ' ') ?? '—'}</td>
                    <td>
                      <button className="ghost" onClick={() => onOpen(i.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

function Kpi({ label, value, target }: { label: string; value: string; target: string }): ReactNode {
  return (
    <tr>
      <td>{label}</td>
      <td><strong>{value}</strong></td>
      <td className="muted small">target {target}</td>
    </tr>
  );
}

function fmt(value: unknown, unit: string): string {
  if (value === null || value === undefined) return 'no data yet';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'no data yet';
  return `${Math.round(n * 10) / 10}${unit}`;
}

function IncidentRow({
  incident,
  onOpen,
}: {
  incident: DashboardIncident;
  onOpen: (id: string) => void;
}): ReactNode {
  return (
    <div
      className="card"
      style={{
        borderLeft: `5px solid ${
          incident.severity === 'P1' ? 'var(--red)' : incident.severity === 'P2' ? 'var(--amber)' : 'var(--line)'
        }`,
      }}
    >
      <div className="btnrow" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="btnrow" style={{ marginBottom: '0.3rem' }}>
            <SeverityChip severity={incident.severity} />
            <span className="chip">{incident.caseType}</span>
            <span className="chip">{incident.state.replace(/_/g, ' ')}</span>
            {incident.flags.drill && <span className="chip drill">DRILL</span>}
            {incident.flags.possibleDuress && <span className="chip p1">POSSIBLE DURESS</span>}
            {incident.flags.possibleAbduction && <span className="chip p1">POSSIBLE ABDUCTION</span>}
            {incident.flags.stealth && <span className="chip demo">STEALTH — arrive quietly</span>}
            {incident.escalatedTo112 && (
              <span className="chip p1">
                112 TOLD {incident.escalationSimulated && '(SIMULATED)'}
              </span>
            )}
            {incident.stale && <span className="chip stale">STALE — needs a human</span>}
            {incident.demoSpeed && <span className="chip demo">DEMO SPEED</span>}
          </div>

          <h2 style={{ marginBottom: '0.2rem' }}>
            {incident.person ? (
              <>
                {incident.person.name}{' '}
                <span className="muted small">
                  {incident.person.flat} · age {incident.person.ageBand}
                </span>
              </>
            ) : (
              <span className="muted">Unknown sender — guard desk only</span>
            )}
          </h2>

          <p className="small">
            Open for <Elapsed since={incident.openedAt} /> ·{' '}
            <LocationLine location={incident.location} description={incident.locationDescription} />
          </p>
          <p className="small muted">
            {incident.alerted} alerted · {incident.accepted} accepted · {incident.declined} declined
          </p>
          {incident.volunteerObservedType && (
            <p className="small">
              <strong>{incident.volunteerObservedType}</strong>
            </p>
          )}
        </div>
        <button className="primary" onClick={() => onOpen(incident.id)}>
          Open
        </button>
      </div>
    </div>
  );
}

function IncidentDetail({ id, onBack }: { id: string; onBack: () => void }): ReactNode {
  const { data, error, reload } = usePolling(
    () => api.get<DashboardDetail>(`/api/dashboard/incidents/${id}`, 'dashboard'),
    2000,
    [id],
  );
  const [packet, setPacket] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading incident" />;

  const { incident, person, dispatches, rankInputs, locations, timeline } = data;
  const best = locations.at(-1) ?? null;
  const verifying = incident.state === 'cancel_verifying';

  const drive = async (outcome: string): Promise<void> => {
    setActionError(null);
    try {
      await api.post(
        `/api/dashboard/incidents/${id}/verification-outcome`,
        { outcome },
        'dashboard',
      );
      reload();
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <>
      <button className="ghost" onClick={onBack}>
        ← Back to the list
      </button>

      <div className="card" style={{ marginTop: '0.7rem' }}>
        <div className="btnrow">
          <SeverityChip severity={incident.severity} />
          <span className="chip">{incident.state.replace(/_/g, ' ')}</span>
          {incident.escalatedTo112 && <span className="chip p1">112 TOLD <SimulatedChip /></span>}
          {incident.demoSpeed && <span className="chip demo">DEMO SPEED</span>}
        </div>
        <h1 style={{ marginTop: '0.5rem' }}>
          {person ? person.name : 'Unknown sender'}{' '}
          <span className="muted small mono">{incident.id}</span>
        </h1>
        {person && (
          <p>
            <strong>{[person.flat, person.address].filter(Boolean).join(', ')}</strong>
            {person.landmark && <span className="muted"> · {person.landmark}</span>}
            <br />
            <span className="small">
              Age {person.ageBand} · feedback profile <code>{person.feedbackProfile}</code>
              {person.protected && ' · protected profile: needs a verified responder'}
            </span>
          </p>
        )}
        <p className="small">
          Open for <Elapsed since={incident.openedAt} /> · search radius {incident.searchRadiusM} m
        </p>
      </div>

      {/* FR-CAN: the demo control for the simulated verification call. */}
      {verifying && (
        <div className="card" style={{ borderColor: 'var(--amber)', borderWidth: 2 }}>
          <h2>Cancel verification in progress</h2>
          <div className="notice sim">
            <div>
              <SimulatedChip what="verification call" /> In a real deployment the provider posts the
              caller's keypress to a webhook. Here you choose the outcome, exactly as the person's
              phone would report it.
            </div>
          </div>
          <ErrorNote error={actionError} />
          <div className="btnrow">
            <button className="primary" onClick={() => void drive('safe')}>
              Pressed 1 — I am safe
            </button>
            <button className="danger" onClick={() => void drive('need_help')}>
              Pressed 9 — I still need help
            </button>
            <button className="warn" onClick={() => void drive('no_answer')}>
              No answer
            </button>
            <button className="danger" onClick={() => void drive('duress')}>
              Duress PIN entered
            </button>
          </div>
          <p className="hint">
            No answer twice, a wrong PIN or the duress PIN all keep the alert alive at high priority —
            while the button stays quiet so an attacker is not tipped off.
          </p>
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h2>Where they are</h2>
          {best ? (
            <>
              <p className="small">{best.description}</p>
              <MiniMap
                center={[best.lat, best.lng]}
                accuracyM={best.accuracyM}
                label={person?.name ?? 'Person'}
                trail={locations.slice(0, -1)}
                tall
              />
              <details style={{ marginTop: '0.6rem' }}>
                <summary>Every position we received ({locations.length})</summary>
                <ul className="small" style={{ paddingLeft: '1.2rem' }}>
                  {locations.map((l, i) => (
                    <li key={i}>
                      <Clock at={l.at} /> — {l.description}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="muted">No position yet.</p>
          )}
        </div>

        <div className="card">
          <h2>Who was alerted, and why</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Volunteer</th>
                  <th>Tier</th>
                  <th>Answer</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {dispatches.map((d) => (
                  <tr key={d.volunteerId}>
                    <td>
                      {d.name}
                      <br />
                      <span className="tiny muted">
                        {d.badge}
                        {d.skill ? ` · ${d.skill}` : ''}
                      </span>
                      {rankInputs[d.volunteerId]?.because && (
                        <ul className="tiny muted" style={{ margin: '0.2rem 0 0', paddingLeft: '1rem' }}>
                          {(rankInputs[d.volunteerId]!.because as string[]).map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>
                      <span className={`chip tier${d.tier}`}>{d.tier}</span>
                      {d.upgradedAt && <span className="tiny muted"> upgraded</span>}
                    </td>
                    <td>
                      {d.response === 'accepted' && <span className="chip ok">accepted</span>}
                      {d.response === 'declined' && (
                        <span className="chip unverified">declined: {d.declineReason}</span>
                      )}
                      {d.response === null && d.stoodDownAt && <span className="chip unverified">stood down</span>}
                      {d.response === null && !d.stoodDownAt && <span className="muted tiny">waiting</span>}
                    </td>
                    <td className="mono">{d.rankScore === null ? '—' : Math.round(d.rankScore)}</td>
                  </tr>
                ))}
                {dispatches.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No volunteer was alerted. Check the timeline for the reason — an unverified
                      incident or a drill never reaches volunteers.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>112 handoff packet</h2>
        <div className="notice sim">
          <div>
            <SimulatedChip what="112 / ERSS handoff" /> No real integration exists. This is exactly
            what would be sent.
          </div>
        </div>
        <button
          className="primary"
          onClick={() => {
            void api
              .get<{ packet: unknown }>(`/api/dashboard/incidents/${id}/handoff-112`, 'dashboard')
              .then((r) => setPacket(r.packet))
              .catch(setActionError);
          }}
        >
          Build the packet
        </button>
        {packet !== null && (
          <pre className="mono small" style={{ overflowX: 'auto', background: '#f7fafb', padding: '0.7rem', borderRadius: 8 }}>
            {JSON.stringify(packet, null, 2)}
          </pre>
        )}
      </div>

      <div className="card">
        <h2>Full timeline</h2>
        <ul className="timeline">
          {timeline.map((e) => (
            <li key={e.seq}>
              <Clock at={e.at} />
              <span>
                <strong>{e.kind.replace(/_/g, ' ')}</strong>{' '}
                <span className="muted tiny">
                  {e.actorType}
                  {e.actorId ? ` ${e.actorId}` : ''}
                </span>
                {Object.keys(e.payload).length > 0 && (
                  <div className="tiny mono muted">{JSON.stringify(e.payload)}</div>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Outbox incidentId={id} />
    </>
  );
}

/** Everything the simulated providers would have sent (NFR-14). */
function Outbox({ incidentId }: { incidentId: string }): ReactNode {
  const { data } = usePolling(
    () =>
      api.get<{ outbox: Array<Record<string, unknown>>; notice: string }>(
        `/api/dashboard/outbox?incident_id=${incidentId}`,
        'dashboard',
      ),
    3000,
    [incidentId],
  );
  if (!data) return null;

  return (
    <details className="card">
      <summary>
        <strong>Messages SafeCircle would have sent ({data.outbox.length})</strong>
      </summary>
      <div className="notice sim" style={{ marginTop: '0.6rem' }}>
        {data.notice}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>To</th>
              <th>Template</th>
              <th>Content</th>
            </tr>
          </thead>
          <tbody>
            {data.outbox.map((o, i) => (
              <tr key={i}>
                <td>{String(o.channel)}</td>
                <td className="mono tiny">{String(o.recipient)}</td>
                <td>{String(o.template ?? '—')}</td>
                <td className="tiny mono">{JSON.stringify(o.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
