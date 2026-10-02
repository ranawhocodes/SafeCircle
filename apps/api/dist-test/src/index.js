/**
 * Server entry point.
 *
 * Starts the HTTP app, the persisted timer runner and the retention jobs, and
 * prints plainly which capabilities on this deployment are simulated.
 */
import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { simulatedCapabilities } from './providers/index.js';
import { TimerRunner, flagStaleIncidents } from './scheduler/runner.js';
import { startRetentionJobs } from './scheduler/retention.js';
async function main() {
    // Applying pending migrations on boot keeps a demo machine from drifting.
    await migrate({ quiet: true });
    const app = await buildApp();
    const timers = new TimerRunner(250, (err) => app.log.error({ err }, 'timer runner error'));
    timers.start();
    const stopRetention = startRetentionJobs((err) => app.log.error({ err }, 'retention job error'));
    // Flag, never auto-close (FR-INC-5).
    const staleSweep = setInterval(() => {
        void flagStaleIncidents().catch((err) => app.log.error({ err }, 'stale sweep failed'));
    }, 60_000);
    staleSweep.unref?.();
    await app.listen({ port: config.port, host: '0.0.0.0' });
    const simulated = simulatedCapabilities();
    app.log.info({
        port: config.port,
        demoTimeScale: config.demoTimeScale,
        simulated,
    }, 'SafeCircle API listening');
    if (simulated.length > 0) {
        app.log.warn(`SIMULATED in this build: ${simulated.join('; ')}. These are never presented as working.`);
    }
    if (config.allowUnsignedDevices) {
        app.log.warn('ALLOW_UNSIGNED_DEVICES is on. Device events are accepted without a signature. Development only.');
    }
    const shutdown = async (signal) => {
        app.log.info({ signal }, 'shutting down');
        clearInterval(staleSweep);
        stopRetention();
        timers.stop();
        await app.close();
        await closePool();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}
main().catch((err) => {
    console.error('Failed to start SafeCircle API:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map