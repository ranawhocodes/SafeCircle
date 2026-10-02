/**
 * Headless device simulator.
 *
 * Stands in for the ESP32 firmware: it signs events with the device key, honours
 * the press timings, and polls for its stage so the light, sound and vibration
 * print exactly as the real button would play them.
 *
 * It exists so the whole chain can be rehearsed and scripted without hardware -
 * and so a demo has a fallback when a breadboard fails on stage.
 *
 *   npm run sim -- press                      raise an alert from GO-021
 *   npm run sim -- press --device HB-001      from a Home button
 *   npm run sim -- press --place mall         no GPS, Wi-Fi scan only
 *   npm run sim -- cancel                     request a cancel
 *   npm run sim -- watch                      follow the status, like the firmware
 *   npm run sim -- walk                       send moving location updates
 *   npm run sim -- scene duress               the whole forced-cancel scene
 */
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const API = process.env.SAFECIRCLE_API ?? 'http://localhost:4000';

/** Demo keys, matching apps/api/src/seed/seed.ts. A real key never leaves the device. */
const DEVICE_KEYS: Record<string, string> = {
  'HB-001': 'demo-key-home-lakshmi-bedroom',
  'HB-002': 'demo-key-home-lakshmi-bathroom',
  'GO-021': 'demo-key-go-lakshmi',
  'GO-042': 'demo-key-go-arjun',
  'GO-077': 'demo-key-go-meera',
  'HB-003': 'demo-key-spare',
};

interface Place {
  label: string;
  location: Record<string, unknown>;
}

const PLACES: Record<string, Place> = {
  home: {
    label: 'At home, GPS fix 8 m',
    location: { gps: { lat: 13.0002, lng: 80.2668, acc_m: 8, age_s: 3 } },
  },
  street: {
    label: 'On the street, GPS fix 20 m',
    location: { gps: { lat: 13.0045, lng: 80.2702, acc_m: 20, age_s: 2 } },
  },
  mall: {
    label: 'Inside a mall, no GPS, Wi-Fi scan only',
    location: { wifi: [{ bssid: 'f0:9f:c2:44:55:66', rssi: -58 }] },
  },
  school: {
    label: 'At school, a saved Wi-Fi network names the building',
    location: { wifi: [{ bssid: 'de:ad:be:ef:00:01', rssi: -52 }] },
  },
  basement: {
    label: 'In a basement, no GPS, cell tower only',
    location: { cell: { mcc: 404, mnc: 0, tac: 0, cell_id: 12345 } },
  },
};

// --- signing ---------------------------------------------------------------

function canonicalise(payload: Record<string, unknown>): string {
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(walk);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'signature') continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = walk(v);
    }
    return out;
  };
  return JSON.stringify(walk(payload));
}

function sign(payload: Record<string, unknown>, key: string): string {
  return createHmac('sha256', key).update(canonicalise(payload)).digest('hex');
}

// --- sequence numbers ------------------------------------------------------

/*
 * Sequence numbers must increase for ever, per device: the server rejects a
 * replay, and it cannot tell a replay from a CLI that restarted its counter.
 *
 * Real firmware keeps this in NVS across reboots. Each `npm run sim` is a fresh
 * process, so the simulator does the same thing with a small state file - and
 * without it, two commands run in the same second would collide.
 */
const STATE_FILE = join(tmpdir(), 'safecircle-sim-sequences.json');

function loadSequences(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function nextSequence(deviceId: string): number {
  const all = loadSequences();
  // Start from wall-clock seconds so a deleted state file still moves forward.
  const next = Math.max((all[deviceId] ?? 0) + 1, Math.floor(Date.now() / 1000));
  all[deviceId] = next;
  try {
    writeFileSync(STATE_FILE, JSON.stringify(all));
  } catch {
    // A read-only temp directory only costs us collisions, not correctness.
  }
  return next;
}

// --- transport -------------------------------------------------------------

interface DeviceReply {
  incident_id?: string;
  stage?: string;
  seq?: number;
  pattern?: {
    light: { colour: string; motion: string; brightness: number };
    sound: { tone: string; volume: number };
    vibration: { pulses: number; length: string };
    meaning: string;
  };
  severity?: string;
  location_source?: string | null;
  location_accuracy_m?: number | null;
  merged?: boolean;
  /** Set on a location_update when the person moved far enough to re-rank. */
  reRanked?: boolean;
  note?: string;
  demo_speed?: boolean;
  incidentOpen?: boolean;
  error?: { code: string; message: string };
}

async function send(
  deviceId: string,
  event: string,
  location?: Record<string, unknown>,
): Promise<DeviceReply & { status: number }> {
  const key = DEVICE_KEYS[deviceId];
  if (!key) throw new Error(`No demo key for ${deviceId}. Known: ${Object.keys(DEVICE_KEYS).join(', ')}`);

  const body: Record<string, unknown> = {
    device_id: deviceId,
    event,
    seq: nextSequence(deviceId),
    battery: 76,
  };
  if (location) body.location = location;
  body.signature = sign(body, key);

  const res = await fetch(`${API}/api/sos/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as DeviceReply;
  return { ...json, status: res.status };
}

async function status(deviceId: string): Promise<DeviceReply & { incident_open?: boolean }> {
  const res = await fetch(`${API}/api/device/${deviceId}/status`);
  return (await res.json()) as DeviceReply & { incident_open?: boolean };
}

// --- rendering -------------------------------------------------------------

const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';
const COLOURS: Record<string, string> = {
  white: '\u001b[97m',
  blue: '\u001b[94m',
  green: '\u001b[92m',
  purple: '\u001b[95m',
  red: '\u001b[91m',
  none: '\u001b[90m',
};

/** Print a pattern the way the device would play it, in all three senses. */
function renderPattern(p: NonNullable<DeviceReply['pattern']>): void {
  const colour = COLOURS[p.light.colour] ?? '';
  const lamp = p.light.colour === 'none' ? '○' : '●';
  const light =
    p.light.colour === 'none'
      ? `${DIM}no light${RESET}`
      : `${colour}${lamp}${RESET} ${p.light.colour} ${p.light.motion} (level ${p.light.brightness})`;
  const sound =
    p.sound.tone === 'none' || p.sound.volume === 0
      ? `${DIM}silent${RESET}`
      : `${p.sound.tone} at volume ${p.sound.volume}`;
  const buzz =
    p.vibration.pulses === 0
      ? `${DIM}no vibration${RESET}`
      : `${'▮'.repeat(p.vibration.pulses)} ${p.vibration.pulses} × ${p.vibration.length}`;

  console.log(`  ${BOLD}${p.meaning}${RESET}`);
  console.log(`    light      ${light}`);
  console.log(`    sound      ${sound}`);
  console.log(`    vibration  ${buzz}`);
}

function reportSend(reply: DeviceReply & { status: number }): void {
  if (reply.status !== 202) {
    console.log(
      `  ${COLOURS.red}refused${RESET} (HTTP ${reply.status}) ${reply.error?.message ?? ''}`,
    );
    console.log(`  ${DIM}The device would show the red failed pattern and retry with back-off.${RESET}`);
    return;
  }
  const bits: string[] = [];
  if (reply.severity) bits.push(reply.severity);
  if (reply.location_source) {
    bits.push(`located by ${reply.location_source} (~${reply.location_accuracy_m} m)`);
  }
  if (reply.merged) bits.push('joined the open incident');
  if (reply.demo_speed) bits.push('demo speed');
  console.log(`  incident ${reply.incident_id ?? '—'}${bits.length ? ` · ${bits.join(' · ')}` : ''}`);
  if (reply.note) console.log(`  ${DIM}${reply.note}${RESET}`);
  if (reply.pattern) renderPattern(reply.pattern);
}

// --- commands --------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

/** A press, with the hold timing printed so a rehearsal can be timed honestly. */
async function cmdPress(): Promise<void> {
  const deviceId = arg('device', 'GO-021');
  const placeKey = arg('place', 'home');
  const place = PLACES[placeKey];
  if (!place) throw new Error(`Unknown place "${placeKey}". Known: ${Object.keys(PLACES).join(', ')}`);

  const isPendant = deviceId.startsWith('GO-');
  console.log(`\n${BOLD}Holding ${deviceId} for 2 seconds${RESET}`);
  if (isPendant) console.log(`  ${DIM}${place.label}${RESET}`);
  else console.log(`  ${DIM}A Home button never moves, so it sends no location.${RESET}`);

  const reply = await send(deviceId, 'panic', isPendant ? place.location : undefined);
  reportSend(reply);
  if (reply.incident_id) console.log(`\n  ${DIM}Follow it with:  npm run sim -- watch --device ${deviceId}${RESET}`);
}

async function cmdCancel(): Promise<void> {
  const deviceId = arg('device', 'GO-021');
  console.log(`\n${BOLD}Holding ${deviceId} for 4 seconds — requesting a cancel${RESET}`);
  const reply = await send(deviceId, 'cancel');
  reportSend(reply);
}

/** Follow the status endpoint the way the firmware does, every 3 seconds. */
async function cmdWatch(): Promise<void> {
  const deviceId = arg('device', 'GO-021');
  console.log(`\n${BOLD}Watching ${deviceId}${RESET} ${DIM}(polling every 3 s, Ctrl-C to stop)${RESET}`);
  let lastSeq = -1;
  for (;;) {
    const s = await status(deviceId);
    if ((s.seq ?? 0) > lastSeq && s.pattern) {
      lastSeq = s.seq ?? 0;
      console.log(`\n[${new Date().toLocaleTimeString()}] stage: ${s.stage} (seq ${s.seq})`);
      renderPattern(s.pattern);
    }
    await sleep(3000);
  }
}

/** Walk away from home, sending updates so responders' maps follow. */
async function cmdWalk(): Promise<void> {
  const deviceId = arg('device', 'GO-021');
  const steps = Number(arg('steps', '6'));
  console.log(`\n${BOLD}Walking with ${deviceId}${RESET} ${DIM}${steps} updates, ~40 m apart${RESET}`);

  let lat = 13.0002;
  let lng = 80.2668;
  for (let i = 0; i < steps; i++) {
    lng += 0.0004; // roughly 40 m east
    const reply = await send(deviceId, 'location_update', {
      gps: { lat, lng, acc_m: 12, age_s: 1 },
    });
    console.log(
      `  step ${i + 1}: ${lat.toFixed(5)}, ${lng.toFixed(5)} → ${
        reply.status === 202 ? `ok${reply.reRanked ? ', re-ranked volunteers' : ''}` : `HTTP ${reply.status}`
      }`,
    );
    await sleep(1500);
  }
}

/**
 * The forced-cancel scene from the demo script (section 22.1, scene 3), run end
 * to end so it can be rehearsed without touching the UI.
 */
async function cmdScene(): Promise<void> {
  const which = process.argv[3] ?? 'duress';
  if (which !== 'duress') throw new Error(`Unknown scene "${which}". Known: duress`);

  const deviceId = arg('device', 'GO-021');
  console.log(`\n${BOLD}Scene: an attacker forces a cancel${RESET}\n`);

  console.log('1. She holds the pendant.');
  reportSend(await send(deviceId, 'panic', PLACES.home!.location));
  await sleep(1500);

  console.log('\n2. She is made to hold it down to cancel.');
  const cancel = await send(deviceId, 'cancel');
  reportSend(cancel);

  console.log(
    `\n3. ${DIM}A verification call goes out. Drive the outcome from the dashboard, or leave it: the deadline treats silence as a real alert.${RESET}`,
  );
  console.log(`\n4. Watch what the attacker can see on the button:`);
  await sleep(2000);
  const s = await status(deviceId);
  if (s.pattern) renderPattern(s.pattern);
  console.log(
    `\n  ${DIM}The alert can be alive at high priority with 112 told, and the button still shows nothing but this.${RESET}`,
  );
}

function usage(): void {
  console.log(`
SafeCircle device simulator

  press    [--device GO-021] [--place home|street|mall|school|basement]
  cancel   [--device GO-021]
  watch    [--device GO-021]
  walk     [--device GO-021] [--steps 6]
  scene    duress [--device GO-021]

Devices: ${Object.keys(DEVICE_KEYS).join(', ')}
API:     ${API}  (override with SAFECIRCLE_API)
`);
}

const command = process.argv[2];
const commands: Record<string, () => Promise<void>> = {
  press: cmdPress,
  cancel: cmdCancel,
  watch: cmdWatch,
  walk: cmdWalk,
  scene: cmdScene,
};

const run = command ? commands[command] : undefined;
if (!run) {
  usage();
  process.exit(command ? 1 : 0);
}

run().catch((err: unknown) => {
  console.error(`\n${COLOURS.red}${(err as Error).message}${RESET}`);
  process.exit(1);
});
