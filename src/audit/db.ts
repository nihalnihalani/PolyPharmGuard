import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '../../data/audit.db');

// Ensure data directory exists
mkdirSync(join(__dirname, '../../data'), { recursive: true });

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      patient_id TEXT,
      tool_name TEXT NOT NULL,
      inputs_hash TEXT NOT NULL,
      outputs_json TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      clinician_id TEXT
    );

    CREATE TABLE IF NOT EXISTS clinician_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      review_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('accept', 'override', 'modify')),
      reason_text TEXT,
      clinician_id TEXT NOT NULL,
      severity TEXT,
      drug TEXT,
      tool_name TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_patient ON tool_calls(patient_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
    CREATE INDEX IF NOT EXISTS idx_actions_review ON clinician_actions(review_id);
  `);
}

export function logToolCall(entry: {
  patientId?: string;
  toolName: string;
  inputsHash: string;
  outputsJson: string;
  latencyMs: number;
  clinicianId?: string;
}): number {
  const db = getDB();
  const stmt = db.prepare(`
    INSERT INTO tool_calls (timestamp, patient_id, tool_name, inputs_hash, outputs_json, latency_ms, clinician_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    new Date().toISOString(),
    entry.patientId ?? null,
    entry.toolName,
    entry.inputsHash,
    entry.outputsJson,
    entry.latencyMs,
    entry.clinicianId ?? null
  );
  return result.lastInsertRowid as number;
}

export function logClinicianAction(entry: {
  reviewId: string;
  findingId: string;
  action: 'accept' | 'override' | 'modify';
  reasonText?: string;
  clinicianId: string;
  severity?: string;
  drug?: string;
  toolName?: string;
}): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO clinician_actions (timestamp, review_id, finding_id, action, reason_text, clinician_id, severity, drug, tool_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    entry.reviewId,
    entry.findingId,
    entry.action,
    entry.reasonText ?? null,
    entry.clinicianId,
    entry.severity ?? null,
    entry.drug ?? null,
    entry.toolName ?? null
  );
}

export function getOverrideStats(): Array<{ toolName: string; action: string; count: number }> {
  const db = getDB();
  return db.prepare(`
    SELECT tool_name as toolName, action, COUNT(*) as count
    FROM clinician_actions
    GROUP BY tool_name, action
    ORDER BY count DESC
  `).all() as Array<{ toolName: string; action: string; count: number }>;
}
