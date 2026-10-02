/** A short index, so a reader can find each face and knows what is simulated. */
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { HonestyBanner } from '../components/common.tsx';

export function Home(): ReactNode {
  return (
    <main>
      <div className="card">
        <h1>SafeCircle</h1>
        <p>
          A neighbourhood safety network that works <strong>even when the person in trouble cannot
          use a smartphone</strong>. It is the first-five-minutes layer that extends 112 — never a
          replacement for it.
        </p>
        <p className="muted">
          <em>No app for victims. A responder app for volunteers.</em>
        </p>
      </div>

      <HonestyBanner />

      <div className="grid two">
        <FaceCard
          to="/sim"
          title="The button"
          who="Face A · the person"
          what="Hold to raise an alert, hold longer to request a cancel. Watch the light, sound and vibration report every stage. Stands in for the ESP32 hardware."
        />
        <FaceCard
          to="/volunteer"
          title="Volunteer app"
          who="Face B · the responder"
          what="Hear the alert, decide in seconds, get there, help well. Shows nothing identifying until you accept."
        />
        <FaceCard
          to="/dashboard"
          title="Guard desk and dashboard"
          who="Guards, society, control room"
          what="Live incidents with the full timeline, why each volunteer was ranked, the 112 handoff packet, and the controls that drive the simulated verification call."
        />
        <FaceCard
          to="/portal"
          title="Setup portal"
          who="Face A · the caregiver"
          what="Pair a device, record the profile and how the button talks back, run a drill that alerts nobody."
        />
      </div>

      <div className="card">
        <h2>How to try the whole chain</h2>
        <ol className="steps">
          <li>
            Open <Link to="/dashboard">the dashboard</Link> in one tab and sign in with{' '}
            <strong>+919999900001</strong>.
          </li>
          <li>
            Open <Link to="/volunteer">the volunteer app</Link> in a second tab as{' '}
            <strong>+919999900101</strong> (Priya N, a verified nurse), and go available.
          </li>
          <li>
            Open <Link to="/sim">the button</Link> in a third tab and hold it for two seconds.
          </li>
          <li>
            Watch the button turn blue, the dashboard light up, and the volunteer get a Tier 1 alarm.
            Accept it, and the button turns green.
          </li>
          <li>
            Hold the button for four seconds to request a cancel, then choose <em>No answer</em> on the
            dashboard. The alert comes back at high priority and the button stays quiet.
          </li>
        </ol>
        <p className="hint">
          The family status page needs an incident: open one from the dashboard and use its family
          link.
        </p>
      </div>
    </main>
  );
}

function FaceCard({
  to,
  title,
  who,
  what,
}: {
  to: string;
  title: string;
  who: string;
  what: string;
}): ReactNode {
  return (
    <Link to={to} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <p className="tiny muted" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {who}
      </p>
      <h2 style={{ margin: '0.2rem 0 0.4rem' }}>{title}</h2>
      <p className="small" style={{ margin: 0 }}>
        {what}
      </p>
    </Link>
  );
}
