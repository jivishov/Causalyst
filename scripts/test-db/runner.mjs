import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

// Refuse remote targets: this command creates roles and fixture schemas.
const url = process.env.TEST_DATABASE_URL;
if (url && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must point to a disposable local database');
}
const db = url ? new pg.Client({ connectionString: url }) : new PGlite();
if (url) await db.connect();
const exec = sql => url ? db.query(sql) : db.exec(sql);
try {
  await exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const path = new URL('../../supabase/migrations/', import.meta.url);
  const files = (await readdir(path)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    let sql = await readFile(new URL(file, path), 'utf8');
    // PGlite has core gen_random_uuid but does not bundle pgcrypto. CI's native
    // PostgreSQL executes the unmodified extension declaration as well.
    if (!url) sql = sql.replace('create extension if not exists pgcrypto;', '');
    await exec(sql);
  }
  const checks = (await readdir(new URL('./', import.meta.url))).filter(f => f.endsWith('.test.sql')).sort();
  for (const file of checks) {
    await exec(await readFile(new URL(file, import.meta.url), 'utf8'));
    console.log(`PASS ${file}`);
  }
  console.log(`Replayed ${files.length} migrations; ${checks.length} SQL suites passed (${url ? 'native PostgreSQL' : 'PGlite PostgreSQL; pgcrypto declaration skipped'}).`);
} finally {
  if (url) await db.end(); else await db.close();
}
