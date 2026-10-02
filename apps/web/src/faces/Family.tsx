/**
 * Face A: the family status page (FR-FAM-1..4).
 *
 * No app, no sign-in: a capability token in the link. It shows the person's own
 * location and who is coming - but never a volunteer's position on a map.
 */
import { useParams } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { api, type FamilyStatus } from '../lib/api.ts';
import {
  Clock,
  ErrorNote,
  LocationLine,
  Progress,
  SimulatedChip,
  Spinner,
  usePolling,
} from '../components/common.tsx';
import { MiniMap } from '../components/MiniMap.tsx';

export function Family(): ReactNode {
  const { token = '' } = useParams();
  const { data, error, reload } = usePolling(
    () => api.get<FamilyStatus>(`/api/family/${token}/status`),
    3000,
    [token],
  );
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) {
    return (
      <main className="narrow">
        <ErrorNote error={error} />
      </main>
    );
  }
  if (!data) return <main className="narrow"><Spinner label="Loading the status" /></main>;

  const act = async (path: string, message: string): Promise<void> => {
    setActionError(null);
    try {
      await api.post(`/api/family/${token}/${path}`, {});
      setAction(message);
      reload();
    } catch (err) {
      setActionError(err);
    }
  };

  const resolved = data.state === 'resolved';

  return (
    <main className="narrow">
      <div className="card">
        <div className="btnrow" style={{ marginBottom: '0.4rem' }}>
          {data.isDrill && <span className="chip drill">DRILL — nobody needs help</span>}
          {data.demoSpeed && <span className="chip demo">DEMO SPEED</span>}
        </div>

        <h1>
          {resolved ? 'Resolved' : 'Help is being arranged'}
          {data.personName && <span className="muted small"> for {data.personName}</span>}
        </h1>

        <Progress state={data.state} />

        {data.state === 'cancel_verifying' && (
          <div className="notice sim" role="status">
            <div>
              <strong>A cancel was requested, and we are checking.</strong> Help has not been
              stopped. If we cannot confirm that they are safe, the alert continues.
            </div>
          </div>
        )}

        {data.escalatedTo112 && (
          <div className="notice danger" role="status">
            <div>
              <strong>Police or ambulance have also been told.</strong>{' '}
              {data.escalationSimulated && <SimulatedChip what="112 handoff" />}
            </div>
          </div>
        )}

        {data.volunteerObservedType && (
          <div className="notice info" role="status">
            {data.volunteerObservedType}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Who is coming</h2>
        {data.responders.length === 0 ? (
          <p className="muted">
            Nobody has accepted yet. Nearby helpers, the security desk and 112 are all being
            contacted.
          </p>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {data.responders.map((r) => (
              <li key={r.name} className="notice good">
                <div>
                  <strong>{r.name}</strong> <span className="chip verified">{r.badge}</span>{' '}
                  {r.skill && <span className="chip ok">{r.skill}</span>}
                  <br />
                  <span className="small">
                    {r.etaS !== null
                      ? `About ${Math.max(1, Math.round(r.etaS / 60))} min away.`
                      : 'On the way.'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          For their safety and yours, we show the helper's name, badge and rough arrival time — never
          their position on a map.
        </p>
      </div>

      {data.personLocation && (
        <div className="card">
          <h2>Where they are</h2>
          <p className="small">
            <LocationLine location={data.personLocation} description={data.locationDescription} />
          </p>
          <MiniMap
            center={[data.personLocation.lat, data.personLocation.lng]}
            accuracyM={data.personLocation.accuracyM}
            label={data.personName ?? 'Person'}
          />
          <p className="hint">
            The shaded circle is how precisely we know the position. A Wi-Fi estimate is a wide
            circle; a GPS fix is a tight one.
          </p>
        </div>
      )}

      <div className="card">
        <h2>What you can do</h2>
        <ErrorNote error={actionError} />
        {action && (
          <div className="notice good" role="status">
            {action}
          </div>
        )}
        <div className="btnrow">
          <button
            className="primary"
            disabled={resolved}
            onClick={() => void act('on-my-way', "We have told the helpers you are on your way.")}
          >
            I'm on my way
          </button>
          <button
            disabled={resolved}
            onClick={() =>
              void act(
                'false-alarm',
                'We are checking that they are safe. Help has not been stopped.',
              )
            }
          >
            This is a false alarm
          </button>
          <button
            onClick={() =>
              void act('share-medical-summary', 'The medical summary is ready to show the hospital.')
            }
          >
            Share medical summary
          </button>
          <button className="danger">Call 112</button>
        </div>
        <p className="hint">
          “This is a false alarm” starts a check — it does not cancel help on its own. That protects
          the person if someone else is pressing it for them.
        </p>
      </div>

      <div className="card">
        <h2>What has happened</h2>
        <ul className="timeline">
          {data.timeline.map((t, i) => (
            <li key={`${t.at}-${i}`}>
              <Clock at={t.at} />
              <span>{t.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="notice sim">{data.notice}</div>
    </main>
  );
}
