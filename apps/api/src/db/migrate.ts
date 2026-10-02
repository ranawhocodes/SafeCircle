/**
 * Migration runner. Applies every .sql file in migrations/ in filename order
 * and records it, so re-running is safe.
 *
 *   npm run db:migrate          apply pending migrations
 *   npm run db:reset            drop everything, then apply from scratch
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The .sql files are source, not build output, so they stay under src/ and are
 * never copied into dist/. Resolve whichever location this module is running
 * from: src/db/ during a type-stripped run, dist/db/ after a build.
 */
/**
 * Find the .sql files.
 *
 * They are source, not build output, so they stay under src/ and are never
 * copied into a build directory. This module can run from src/db/, dist/db/ or
 * dist-test/src/db/, so rather than enumerate those, walk up looking for the
 * package root and take its src/db/migrations.
 */
function locateMigrations(): string {
  const candidates = [join(here, 'migrations')];
  let dir = here;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(join(dir, 'src', 'db', 'migrations'));
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      `Could not locate a migrations directory from ${here}. Looked in:\n  ${candidates.join('\n  ')}`,
    );
  }
  return found;
}

const migrationsDir = locateMigrations();

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

async function reset(): Promise<void> {
  // A clean slate without needing dropdb/createdb, so tests can reset quickly.
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

export async function migrate(opts: { reset?: boolean; quiet?: boolean } = {}): Promise<string[]> {
  if (opts.reset) await reset();
  await ensureTable();

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
      if (!opts.quiet) console.log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (ran.length === 0 && !opts.quiet) console.log('no pending migrations');
  return ran;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

if (invokedDirectly) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(closePool)
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
