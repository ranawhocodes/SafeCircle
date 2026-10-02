/**
 * Device simulator.
 *
 * A faithful stand-in for the ESP32 firmware: hold ~2 s to raise an SOS, hold
 * ~4 s to request a cancel, and poll the status endpoint so the light, sound and
 * vibration patterns play exactly as the real button would.
 *
 * It signs its payloads with the demo HMAC key, so it exercises the real
 * authenticity path rather than a bypass. Keys are per-device demo values that
 * also live in the seed - a real device's key never leaves the device.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PRESS, type DeviceStage, type FeedbackPattern } from '@safecircle/shared';
import { HonestyBanner, SimulatedChip } from '../components/common.tsx';

const DEVICES = [
  { id: 'GO-021', key: 'demo-key-go-lakshmi', label: 'Lakshmi — Go pendant', type: 'go' },
  { id: 'HB-001', key: 'demo-key-home-lakshmi-bedroom', label: 'Lakshmi — bedroom button', type: 'home' },
  { id: 'GO-042', key: 'demo-key-go-arjun', label: 'Arjun (9) — bag tag pendant', type: 'go' },
  { id: 'GO-077', key: 'demo-key-go-meera', label: 'Meera — Stealth mode pendant', type: 'go' },
] as const;

/** Positions a presenter can send, including the indoor no-GPS case. */
const PLACES = [
  {
    label: 'At home — GPS fix, 8 m',
    location: { gps: { lat: 13.0002, lng: 80.2668, acc_m: 8, age_s: 3 } },
  },
  {
    label: 'Inside the mall — no GPS, Wi-Fi scan only',
    location: { wifi: [{ bssid: 'f0:9f:c2:44:55:66', rssi: -58 }] },
  },
  {
    label: 'At school — saved Wi-Fi, a known place',
    location: { wifi: [{ bssid: 'de:ad:be:ef:00:01', rssi: -52 }] },
  },
  {
    label: 'On the street — GPS fix, 20 m',
    location: { gps: { lat: 13.0045, lng: 80.2702, acc_m: 20, age_s: 2 } },
  },
  {
    label: 'Basement — no GPS, cell tower only',
    location: { cell: { mcc: 404, mnc: 0, tac: 0, cell_id: 12345 } },
  },
] as const;

/** The same canonical form the firmware and the server agree on. */
function canonicalise(payload: Record<string, unknown>): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (k === 'signature') continue;
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;
      out[k] = walk(val);
    }
    return out;
  };
  return JSON.stringify(walk(payload));
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface LogLine {
  at: Date;
  text: string;
  kind: 'out' | 'in' | 'warn';
}

export function Simulator(): ReactNode {
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [placeIndex, setPlaceIndex] = useState(0);
  const device = DEVICES[deviceIndex]!;
  const place = PLACES[placeIndex]!;

  const [stage, setStage] = useState<DeviceStage>('idle');
  const [pattern, setPattern] = useState<FeedbackPattern | null>(null);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [heldMs, setHeldMs] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [online, setOnline] = useState(true);
  const seqRef = useRef(Math.floor(Date.now() / 1000));
  const holdStartRef = useRef<number | null>(null);
  const sentThisHoldRef = useRef(false);

  const say = useCallback((text: string, kind: LogLine['kind'] = 'in') => {
    setLog((l) => [{ at: new Date(), text, kind }, ...l].slice(0, 60));
  }, []);

  /** Send a signed event, exactly as the firmware does. */
  const send = useCallback(
    async (event: string, withLocation: boolean): Promise<void> => {
      if (!online) {
        // Section 18.7: queue, retry with back-off, show the failed pattern.
        setStage('failed');
        say('No network. Queued and retrying with back-off, red pattern showing.', 'warn');
        return;
      }
      seqRef.current += 1;
      const body: Record<string, unknown> = {
        device_id: device.id,
        event,
        seq: seqRef.current,
        battery: 76,
      };
      if (withLocation && device.type === 'go') body.location = place.location;
      body.signature = await hmacHex(device.key, canonicalise(body));

      say(`→ ${event} (seq ${seqRef.current})${withLocation ? ` with ${place.label}` : ''}`, 'out');
      setStage('sending');

      try {
        const res = await fetch('/api/sos/device', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as {
          incident_id?: string;
          stage?: DeviceStage;
          pattern?: FeedbackPattern;
          severity?: string;
          location_source?: string;
          location_accuracy_m?: number;
          merged?: boolean;
          note?: string;
          error?: { message: string };
        };
        if (!res.ok) {
          setStage('failed');
          say(`← refused (${res.status}): ${json.error?.message ?? 'rejected'}`, 'warn');
          return;
        }
        if (json.incident_id) setIncidentId(json.incident_id);
        if (json.stage) setStage(json.stage);
        if (json.pattern) setPattern(json.pattern);
        say(
          `← ${json.stage ?? 'ok'}${json.severity ? ` · ${json.severity}` : ''}` +
            (json.location_source
              ? ` · located by ${json.location_source} (~${json.location_accuracy_m} m)`
              : '') +
            (json.merged ? ' · joined the open incident' : '') +
            (json.note ? ` · ${json.note}` : ''),
        );
      } catch (err) {
        setStage('failed');
        say(`← send failed: ${(err as Error).message}. Retrying.`, 'warn');
      }
    },
    [device, place, online, say],
  );

  /** Press timing, exactly as the firmware measures it (section 18.7). */
  const startHold = (): void => {
    holdStartRef.current = Date.now();
    sentThisHoldRef.current = false;
    setHolding(true);
    setHeldMs(0);
    setStage('holding');
  };

  const endHold = (): void => {
    const held = holdStartRef.current === null ? 0 : Date.now() - holdStartRef.current;
    holdStartRef.current = null;
    setHolding(false);
    setHeldMs(0);

    if (sentThisHoldRef.current) return;

    if (held >= PRESS.cancelHoldMs) {
      void send('cancel', false);
    } else if (held >= PRESS.sosHoldMs) {
      void send('panic', true);
    } else {
      // A brush is ignored - that is the whole reason for the hold.
      setStage(incidentId ? stage : 'idle');
      say(`Ignored a ${held} ms touch: a hold of ${PRESS.sosHoldMs} ms is needed.`, 'warn');
    }
  };

  useEffect(() => {
    if (!holding) return;
    const t = setInterval(() => {
      const held = holdStartRef.current === null ? 0 : Date.now() - holdStartRef.current;
      setHeldMs(held);
    }, 50);
    return () => clearInterval(t);
  }, [holding]);

  /** The status poll (section 7.3): every 3 s during an incident. */
  useEffect(() => {
    let alive = true;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/device/${device.id}/status`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          stage: DeviceStage;
          seq: number;
          pattern: FeedbackPattern;
          incident_open: boolean;
        };
        if (!alive) return;
        setPattern(json.pattern);
        setStage((current) => {
          if (json.stage !== current) {
            say(`← status poll: ${json.stage} (seq ${json.seq}) — "${json.pattern.meaning}"`);
          }
          return json.stage;
        });
        if (!json.incident_open) setIncidentId(null);
      } catch {
        /* a dropped poll is normal; the next one will do */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [device.id, say]);

  const holdProgress = Math.min(100, (heldMs / PRESS.cancelHoldMs) * 100);
  const nextAction =
    heldMs >= PRESS.cancelHoldMs ? 'release to CANCEL' : heldMs >= PRESS.sosHoldMs ? 'release to send SOS' : 'keep holding';

  return (
    <main className="narrow">
      <HonestyBanner />

      <div className="notice info">
        <div>
          This is the <strong>device simulator</strong>. It behaves like the ESP32 firmware: it signs
          every event with the device key, holds for {PRESS.sosHoldMs / 1000} s to raise an SOS and{' '}
          {PRESS.cancelHoldMs / 1000} s to request a cancel, and polls for its status so the light,
          sound and vibration play as the real button would.{' '}
          <SimulatedChip what="hardware" />
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="device">Device</label>
          <select id="device" value={deviceIndex} onChange={(e) => setDeviceIndex(Number(e.target.value))}>
            {DEVICES.map((d, i) => (
              <option key={d.id} value={i}>
                {d.id} — {d.label}
              </option>
            ))}
          </select>
        </div>
        {device.type === 'go' && (
          <div className="field">
            <label htmlFor="place">Where the pendant is</label>
            <select id="place" value={placeIndex} onChange={(e) => setPlaceIndex(Number(e.target.value))}>
              {PLACES.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="hint">
              A Home button never moves, so it has no GPS and uses the registered address.
            </p>
          </div>
        )}
        <label style={{ marginTop: '0.6rem' }}>
          <input
            type="checkbox"
            checked={!online}
            onChange={(e) => setOnline(!e.target.checked)}
            style={{ width: 'auto', minHeight: 'auto', marginRight: '0.45rem' }}
          />
          Simulate no network (shows the failed pattern and retries)
        </label>
      </div>

      <div className="device">
        <div
          className={[
            'led',
            pattern?.light.colour ?? 'none',
            pattern?.light.motion === 'fast_blink' ? 'blink' : '',
            pattern?.light.motion === 'slow_pulse' ? 'pulse' : '',
            pattern?.light.motion === 'fast_pulse' ? 'fastpulse' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ opacity: pattern ? 0.35 + (pattern.light.brightness / 5) * 0.65 : 1 }}
          role="img"
          aria-label={`Light: ${pattern?.light.colour ?? 'off'}, ${pattern?.light.motion ?? 'off'}`}
        />

        <p style={{ margin: '0 0 0.2rem', fontWeight: 700, color: '#fff' }}>
          {pattern?.meaning ?? 'Ready'}
        </p>
        <p className="tiny" style={{ margin: 0, opacity: 0.8 }}>
          stage: {stage}
          {incidentId && <> · incident {incidentId.slice(0, 12)}…</>}
        </p>

        <div className="senses">
          <div className="sense">
            <div className="k">Light</div>
            <div className="v">
              {pattern?.light.colour === 'none' ? 'off' : `${pattern?.light.colour ?? 'off'}`}
            </div>
            <div className="tiny">{pattern?.light.motion ?? '—'} · level {pattern?.light.brightness ?? 0}</div>
          </div>
          <div className="sense">
            <div className="k">Sound</div>
            <div className="v">{pattern?.sound.tone === 'none' ? 'silent' : pattern?.sound.tone ?? 'silent'}</div>
            <div className="tiny">volume {pattern?.sound.volume ?? 0}</div>
          </div>
          <div className="sense">
            <div className="k">Vibration</div>
            <div className="v">
              {(pattern?.vibration.pulses ?? 0) === 0 ? 'none' : `${pattern?.vibration.pulses} ×`}
            </div>
            <div className="tiny">{pattern?.vibration.length ?? '—'}</div>
          </div>
        </div>

        <div style={{ marginTop: '1.2rem' }}>
          <button
            className="press-btn"
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={() => holding && endHold()}
            onKeyDown={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && !holding) {
                e.preventDefault();
                startHold();
              }
            }}
            onKeyUp={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && holding) {
                e.preventDefault();
                endHold();
              }
            }}
          >
            {holding ? nextAction : 'HOLD'}
          </button>
          {holding && (
            <>
              <div className="progress" style={{ marginTop: '0.8rem' }}>
                <div
                  className="step done"
                  style={{ flex: holdProgress, transition: 'none' }}
                  aria-hidden="true"
                />
                <div className="step" style={{ flex: 100 - holdProgress }} aria-hidden="true" />
              </div>
              <p className="tiny" style={{ color: '#cfe0ef' }}>
                held {Math.round(heldMs)} ms — {PRESS.sosHoldMs} ms sends, {PRESS.cancelHoldMs} ms cancels
              </p>
            </>
          )}
        </div>

        <div className="btnrow" style={{ justifyContent: 'center', marginTop: '0.9rem' }}>
          <button
            className="ghost"
            style={{ color: '#cfe0ef', borderColor: '#1d3f68' }}
            onClick={() => void send('location_update', true)}
            disabled={device.type !== 'go'}
          >
            Send a location update
          </button>
          <button
            className="ghost"
            style={{ color: '#cfe0ef', borderColor: '#1d3f68' }}
            onClick={() => void send('heartbeat', false)}
          >
            Heartbeat
          </button>
        </div>
      </div>

      <div className="card">
        <h3>What the device is doing</h3>
        <ul className="timeline">
          {log.map((l, i) => (
            <li key={i}>
              <time>{l.at.toLocaleTimeString()}</time>
              <span style={{ color: l.kind === 'warn' ? 'var(--red-deep)' : undefined }}>
                {l.text}
              </span>
            </li>
          ))}
          {log.length === 0 && <li className="muted">Hold the button to raise an alert.</li>}
        </ul>
      </div>
    </main>
  );
}
