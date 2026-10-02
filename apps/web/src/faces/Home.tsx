/**
 * A bold, premium home page inspired by the SOS app design language.
 * Hero section with dramatic typography, clean service cards with icons.
 */
import { Link } from 'react-router-dom';
import { useCallback, useState, type ReactNode } from 'react';
import { HonestyBanner } from '../components/common.tsx';

const FACES = [
  {
    to: '/sim',
    icon: '🔴',
    title: 'Emergency Button',
    who: 'The person',
    what: 'Hold to raise an alert, hold longer to cancel. Watch the light, sound and vibration through every stage.',
  },
  {
    to: '/volunteer',
    icon: '🛡️',
    title: 'Volunteer App',
    who: 'The responder',
    what: 'Hear the alert, decide in seconds, get there, help well. No identifying info until you accept.',
  },
  {
    to: '/dashboard',
    icon: '📊',
    title: 'Guard Dashboard',
    who: 'Control room',
    what: 'Live incidents, full timeline, volunteer ranking, 112 handoff, and verification controls.',
  },
  {
    to: '/portal',
    icon: '⚙️',
    title: 'Setup Portal',
    who: 'The caregiver',
    what: 'Pair a device, record the profile, configure feedback, and run a drill.',
  },
] as const;

export function Home(): ReactNode {
  return (
    <main>
      {/* Hero */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0a1e3d 0%, #060d1a 100%)',
          borderRadius: '20px',
          padding: '2.5rem 2rem',
          color: '#fff',
          textAlign: 'center',
          marginBottom: '1.25rem',
          boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle glow accent */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '-60%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(27,154,170,0.15) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <h1
          style={{
            fontFamily: "'Outfit', system-ui, sans-serif",
            fontSize: '2.4rem',
            fontWeight: 900,
            letterSpacing: '-0.02em',
            margin: '0 0 0.4rem',
            position: 'relative',
          }}
        >
          SafeCircle
        </h1>
        <p
          style={{
            fontSize: '1.05rem',
            opacity: 0.75,
            margin: '0 auto 1rem',
            maxWidth: '460px',
            position: 'relative',
            lineHeight: 1.5,
          }}
        >
          The first-five-minutes safety network.{' '}
          <strong style={{ opacity: 1, color: '#2fc0d1' }}>
            Works even when the person cannot use a smartphone.
          </strong>
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '2rem',
            marginTop: '1.5rem',
            flexWrap: 'wrap',
            position: 'relative',
          }}
        >
          {[
            ['🛡️', '24/7 PROTECTION'],
            ['📍', 'REAL-TIME LOCATION'],
            ['🔒', 'PRIVATE & SECURE'],
          ].map(([icon, label]) => (
            <div key={label} style={{ textAlign: 'center', minWidth: '100px' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>{icon}</div>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  opacity: 0.7,
                  fontFamily: "'Outfit', system-ui, sans-serif",
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <HonestyBanner />

      {/* Service cards */}
      <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
        {FACES.map((f) => (
          <Link
            key={f.to}
            to={f.to}
            className="card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem 1.25rem',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.4rem',
                flexShrink: 0,
              }}
            >
              {f.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', fontFamily: "'Outfit', system-ui, sans-serif" }}>
                {f.title}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#6b7f94', lineHeight: 1.4, marginTop: '0.15rem' }}>
                {f.what}
              </div>
            </div>
            <div style={{ color: '#b0bec5', fontSize: '1.2rem', flexShrink: 0 }}>›</div>
          </Link>
        ))}
      </div>

      {/* How-to section */}
      <div className="card" style={{ marginTop: '1.25rem' }}>
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

      {/* Internal-only reset icon */}
      <ResetAllIcon />
    </main>
  );
}

/**
 * A discreet internal-use-only reset control.
 * No label. Low opacity. Tooltip explains what it does.
 * Place it out of the way so a demo audience never notices it.
 */
function ResetAllIcon(): ReactNode {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const reset = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setDone(false);
    try {
      await fetch('/api/device/reset-all', { method: 'POST' });
      try { localStorage.removeItem('safecircle.active_incident.volunteer'); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('safecircle:demo-reset'));
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      /* silent — this is an internal tool */
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <button
      onClick={() => void reset()}
      title="Reset all incidents and devices to idle (internal use)"
      aria-label="Reset all incidents and devices"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        opacity: done ? 0.9 : 0.18,
        fontSize: '1.3rem',
        lineHeight: 1,
        padding: '0.3rem',
        transition: 'opacity 0.2s',
        minHeight: 'auto',
        color: done ? 'var(--teal, #1abc9c)' : 'currentColor',
        transform: busy ? 'rotate(180deg)' : 'none',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = done ? '0.9' : '0.18'; }}
    >
      {done ? '✓' : '⟳'}
    </button>
  );
}
