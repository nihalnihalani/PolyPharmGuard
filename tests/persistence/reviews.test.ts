import { describe, it, expect, beforeEach } from 'vitest';
import { getDB } from '../../src/audit/db.js';
import { saveReview, loadReview, listReviews, getReviewExists } from '../../src/persistence/reviews.js';

describe('reviews persistence', () => {
  beforeEach(() => {
    // Wipe the reviews table before each test so cases are independent.
    const db = getDB();
    db.exec(`DROP TABLE IF EXISTS reviews;`);
    // Re-create lazily on first save by triggering a no-op call.
    // (saveReview ensures the table internally.)
  });

  it('round-trips a snapshot — saveReview then loadReview returns identical data', () => {
    const snap = {
      id: 'review_test_001',
      patientId: 'test-patient-123',
      createdAt: '2026-05-10T22:00:00.000Z',
      inputs: { medications: ['warfarin', 'aspirin'], patientAge: 78 },
      outputs: { findings: { cascade: [{ severity: 'HIGH', finding: 'CYP2C9 cascade' }] } },
      scorerVersion: 'composite_heuristic_v1',
      appVersion: '1.0.0',
    };

    saveReview(snap);
    const loaded = loadReview(snap.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(snap.id);
    expect(loaded!.patientId).toBe(snap.patientId);
    expect(loaded!.createdAt).toBe(snap.createdAt);
    expect(loaded!.inputs).toEqual(snap.inputs);
    expect(loaded!.outputs).toEqual(snap.outputs);
    expect(loaded!.scorerVersion).toBe(snap.scorerVersion);
    expect(loaded!.appVersion).toBe(snap.appVersion);
  });

  it('returns null for non-existent reviewId', () => {
    expect(loadReview('review_does_not_exist')).toBeNull();
    expect(getReviewExists('review_does_not_exist')).toBe(false);
  });

  it('overwrites idempotently when the same reviewId is saved twice', () => {
    const base = {
      id: 'review_overwrite',
      patientId: 'p1',
      createdAt: '2026-05-10T22:00:00.000Z',
      inputs: { medications: ['a'] },
      outputs: { findings: { cascade: [] } },
    };

    saveReview(base);
    saveReview({ ...base, outputs: { findings: { cascade: [{ severity: 'HIGH', finding: 'updated' }] } } });

    const loaded = loadReview(base.id);
    expect(loaded).not.toBeNull();
    const out = loaded!.outputs as { findings: { cascade: { finding: string }[] } };
    expect(out.findings.cascade[0].finding).toBe('updated');
  });

  it('listReviews returns reviews for a patient in newest-first order', () => {
    saveReview({
      id: 'review_listA',
      patientId: 'patient-A',
      createdAt: '2026-05-09T10:00:00.000Z',
      inputs: {},
      outputs: {},
    });
    saveReview({
      id: 'review_listB',
      patientId: 'patient-A',
      createdAt: '2026-05-10T10:00:00.000Z',
      inputs: {},
      outputs: {},
    });
    saveReview({
      id: 'review_listC',
      patientId: 'patient-OTHER',
      createdAt: '2026-05-10T11:00:00.000Z',
      inputs: {},
      outputs: {},
    });

    const list = listReviews('patient-A');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('review_listB'); // newer first
    expect(list[1].id).toBe('review_listA');
  });
});
