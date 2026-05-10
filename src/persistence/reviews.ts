/**
 * Persisted review snapshots.
 *
 * Stores the canonical inputs + outputs of every clinical review so:
 *   1. Reports (`/api/reports/[reviewId]`) and patient summaries reference
 *      the *exact same* clinical result the clinician saw, not a re-run
 *      that could differ if KB or scorer code changed between view + export.
 *   2. Clinician actions (accept/override/modify) reference an immutable
 *      snapshot, so the audit trail can answer "what was the finding when
 *      the clinician decided?".
 *   3. Listing reviews per patient becomes cheap.
 *
 * Implementation: piggybacks on the existing better-sqlite3 connection from
 * src/audit/db.ts. We add one table — `reviews` — and four functions
 * (saveReview, loadReview, listReviews, getReviewExists). Failures during
 * write are NON-FATAL: the caller logs the error and still returns the
 * computed review to the user. Persistence is best-effort durability, not
 * a hard dependency for serving the request.
 */

import { getDB } from '../audit/db.js';

export interface ReviewSnapshot {
  id: string;
  patientId: string;
  createdAt: string; // ISO 8601
  inputs: unknown;
  outputs: unknown;
  scorerVersion?: string;
  appVersion?: string;
}

function ensureReviewsTable(): void {
  // Always execute — CREATE TABLE IF NOT EXISTS is idempotent and the cost
  // of running it on every call is negligible for SQLite. We previously
  // memoized this with a module-level flag, but that broke tests that
  // legitimately drop the table between runs (and would also break in a
  // real deployment if the DB file were swapped under us).
  const db = getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      inputs_json TEXT NOT NULL,
      outputs_json TEXT NOT NULL,
      scorer_version TEXT,
      app_version TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_patient ON reviews(patient_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at);
  `);
}

export function saveReview(snap: ReviewSnapshot): void {
  ensureReviewsTable();
  const db = getDB();
  // INSERT OR REPLACE — idempotent if the same reviewId is written twice
  // (e.g. caller retries). Snapshots are immutable in spirit, but we
  // tolerate duplicate writes rather than throwing.
  db.prepare(`
    INSERT OR REPLACE INTO reviews
      (id, patient_id, created_at, inputs_json, outputs_json, scorer_version, app_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    snap.id,
    snap.patientId,
    snap.createdAt,
    JSON.stringify(snap.inputs),
    JSON.stringify(snap.outputs),
    snap.scorerVersion ?? null,
    snap.appVersion ?? null,
  );
}

export function loadReview(reviewId: string): ReviewSnapshot | null {
  ensureReviewsTable();
  const db = getDB();
  const row = db.prepare(`
    SELECT id, patient_id as patientId, created_at as createdAt,
           inputs_json as inputsJson, outputs_json as outputsJson,
           scorer_version as scorerVersion, app_version as appVersion
    FROM reviews
    WHERE id = ?
  `).get(reviewId) as
    | { id: string; patientId: string; createdAt: string; inputsJson: string; outputsJson: string; scorerVersion: string | null; appVersion: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patientId,
    createdAt: row.createdAt,
    inputs: JSON.parse(row.inputsJson),
    outputs: JSON.parse(row.outputsJson),
    scorerVersion: row.scorerVersion ?? undefined,
    appVersion: row.appVersion ?? undefined,
  };
}

export function listReviews(patientId: string, limit = 50): Array<{ id: string; patientId: string; createdAt: string }> {
  ensureReviewsTable();
  const db = getDB();
  return db.prepare(`
    SELECT id, patient_id as patientId, created_at as createdAt
    FROM reviews
    WHERE patient_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(patientId, limit) as Array<{ id: string; patientId: string; createdAt: string }>;
}

export function getReviewExists(reviewId: string): boolean {
  ensureReviewsTable();
  const db = getDB();
  const row = db.prepare(`SELECT 1 as exists_flag FROM reviews WHERE id = ?`).get(reviewId);
  return row !== undefined;
}
