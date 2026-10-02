/** Provider wiring. Swapping a simulated adapter for a real one happens here. */
import { config } from '../config.js';
import {
  OfflineGeolocation,
  SimulatedAuthority,
  SimulatedIdentity,
  SimulatedMessaging,
  SimulatedVoice,
  WebSocketPush,
} from './simulated.js';
import type { Providers } from './ports.js';

export * from './ports.js';
export { OfflineGeolocation, WebSocketPush } from './simulated.js';

/** The push adapter is shared, because routes register sockets against it. */
export const webSocketPush = new WebSocketPush();
export const offlineGeolocation = new OfflineGeolocation();

export function buildProviders(): Providers {
  if (config.providers.voice !== 'simulated') {
    throw new Error(
      `Voice provider "${config.providers.voice}" is not implemented. Only "simulated" exists in iteration 1.`,
    );
  }
  return {
    voice: new SimulatedVoice(),
    messaging: new SimulatedMessaging(),
    push: webSocketPush,
    authority: new SimulatedAuthority(),
    geolocation: offlineGeolocation,
    identity: new SimulatedIdentity(),
  };
}

export const providers = buildProviders();

/** Which capabilities on this deployment are simulated, for the UI banner. */
export function simulatedCapabilities(): string[] {
  const out: string[] = [];
  if (providers.voice.name === 'simulated') out.push('Cancel verification call');
  if (providers.messaging.name === 'simulated') out.push('WhatsApp and SMS delivery');
  if (providers.authority.name === 'simulated') out.push('112 / ERSS handoff');
  if (providers.geolocation.name === 'offline') out.push('Wi-Fi and cell positioning');
  if (providers.identity.name === 'simulated') out.push('Government ID checks');
  return out;
}
