/**
 * The Fastify app: plugins, rate limits, WebSocket streams and error shape.
 *
 * Built separately from `index.ts` so tests can `inject` into it without opening
 * a port.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { DisclosureDeniedError } from '@safecircle/shared';
import { config } from './config.js';
import { bystanderRoutes } from './routes/bystander.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceRoutes } from './routes/device.js';
import { familyRoutes } from './routes/family.js';
import { portalRoutes } from './routes/portal.js';
import { volunteerRoutes } from './routes/volunteer.js';
import { webhookRoutes } from './routes/webhooks.js';
import { findSession } from './security/auth.js';
import { webSocketPush } from './providers/index.js';
import { findIncidentByFamilyToken } from './db/repositories/incidents.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Never log a signature, a token or a device key.
      redact: [
        'req.headers.authorization',
        'req.headers["x-safecircle-signature"]',
        'req.body.signature',
        'req.body.code',
      ],
    },
    // A life-safety endpoint should not fail on a trailing slash.
    ignoreTrailingSlash: true,
    bodyLimit: 256 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  /**
   * Rate limits (API contract section 8). Devices are keyed by their id rather
   * than their IP, because a whole society can share one NAT address.
   */
  await app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const body = req.body as { device_id?: string } | undefined;
      return body?.device_id ?? req.ip;
    },
  });

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof DisclosureDeniedError) {
      return reply
        .code(403)
        .send({ error: { code: 'briefing_not_authorised', message: 'Accept the alert first.' } });
    }
    if ((err as { validation?: unknown }).validation) {
      return reply
        .code(400)
        .send({ error: { code: 'bad_request', message: 'That request was not understood.' } });
    }
    req.log.error({ err }, 'unhandled error');
    // Never leak an internal message to a caller.
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  app.setNotFoundHandler(async (_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } }),
  );

  app.get('/health', async () => ({ ok: true, service: 'safecircle-api' }));

  // --- routes --------------------------------------------------------------
  await app.register(async (scoped) => {
    // A button pressed repeatedly in a panic must not be throttled into silence,
    // so the limit is generous but finite.
    await scoped.register(rateLimit, { max: 30, timeWindow: '1 minute' });
    await deviceRoutes(scoped);
  });

  await app.register(async (scoped) => {
    await scoped.register(rateLimit, { max: 20, timeWindow: '1 hour' });
    await bystanderRoutes(scoped);
  });

  await app.register(webhookRoutes);
  await app.register(portalRoutes);
  await app.register(volunteerRoutes);
  await app.register(familyRoutes);
  await app.register(dashboardRoutes);

  // --- live streams --------------------------------------------------------

  /**
   * A volunteer's alert socket. This is the `PushPort` delivery channel, so an
   * open PWA receives Tier 1 alarms in real time.
   */
  app.get<{ Querystring: { token?: string } }>(
    '/ws/volunteer',
    { websocket: true },
    async (socket, req) => {
      const session = req.query.token ? await findSession(req.query.token) : null;
      if (!session || (session.subjectType !== 'volunteer' && session.subjectType !== 'guard')) {
        socket.close(4401, 'unauthenticated');
        return;
      }
      const unregister = webSocketPush.register(session.subjectId, {
        send: (data) => socket.send(data),
      });
      socket.send(JSON.stringify({ type: 'connected', volunteerId: session.subjectId }));
      socket.on('close', unregister);
    },
  );

  /** The dashboard's live incident stream. */
  app.get<{ Querystring: { token?: string } }>(
    '/ws/dashboard',
    { websocket: true },
    async (socket, req) => {
      const session = req.query.token ? await findSession(req.query.token) : null;
      if (!session || (session.subjectType !== 'dashboard' && session.subjectType !== 'guard')) {
        socket.close(4401, 'unauthenticated');
        return;
      }
      dashboardSockets.add(socket);
      socket.send(JSON.stringify({ type: 'connected' }));
      socket.on('close', () => dashboardSockets.delete(socket));
    },
  );

  /** The family status page, refreshed without polling. */
  app.get<{ Params: { token: string } }>(
    '/ws/family/:token',
    { websocket: true },
    async (socket, req) => {
      const incident = await findIncidentByFamilyToken(req.params.token);
      if (!incident) {
        socket.close(4404, 'unknown link');
        return;
      }
      const set = familySockets.get(incident.id) ?? new Set();
      set.add(socket);
      familySockets.set(incident.id, set);
      socket.send(JSON.stringify({ type: 'connected', incidentId: incident.id }));
      socket.on('close', () => {
        set.delete(socket);
        if (set.size === 0) familySockets.delete(incident.id);
      });
    },
  );

  return app;
}

type Sendable = { send(data: string): void };

const dashboardSockets = new Set<Sendable>();
const familySockets = new Map<string, Set<Sendable>>();

/** Broadcast to every open dashboard. Failures are ignored: a dead socket closes itself. */
export function broadcastDashboard(payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const s of dashboardSockets) {
    try {
      s.send(data);
    } catch {
      /* the close handler will clean up */
    }
  }
}

export function broadcastFamily(incidentId: string, payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const s of familySockets.get(incidentId) ?? []) {
    try {
      s.send(data);
    } catch {
      /* the close handler will clean up */
    }
  }
}
