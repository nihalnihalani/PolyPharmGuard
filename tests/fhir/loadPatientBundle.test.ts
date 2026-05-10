import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FHIRClient, FHIRError } from '../../src/fhir/client.js';
import { loadPatientBundle, loadPatientObservations } from '../../src/fhir/queries.js';

// We mock the global fetch so we can drive the FHIRClient through every path:
// happy aggregation, partial-failure (one query rejects), and the new
// timeout / 5xx-retry behavior added in client.ts.
type FetchResponseInit = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function fhirResponse(body: unknown, status: number = 200): FetchResponseInit {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function mockFetchSequence(responses: FetchResponseInit[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  return fetchMock;
}

const samplePatient = {
  resourceType: 'Patient',
  id: 'abc-123',
  birthDate: '1947-08-15',
  name: [{ given: ['Jane'], family: 'Doe' }],
};

const sampleMedsBundle = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'MedicationRequest',
        id: 'med-1',
        status: 'active',
        intent: 'order',
        subject: { reference: 'Patient/abc-123' },
        medicationCodeableConcept: { text: 'Metformin 1000mg' },
      },
    },
  ],
};

const sampleObsBundle = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'Observation',
        id: 'obs-1',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '33914-3', display: 'eGFR' }] },
        subject: { reference: 'Patient/abc-123' },
        valueQuantity: { value: 28, unit: 'mL/min/1.73m2' },
        effectiveDateTime: '2026-04-01',
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        id: 'obs-2',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '6301-6', display: 'INR' }] },
        subject: { reference: 'Patient/abc-123' },
        valueQuantity: { value: 2.4, unit: '{INR}' },
        effectiveDateTime: '2026-04-15',
      },
    },
  ],
};

const sampleCondBundle = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'Condition',
        id: 'cond-1',
        clinicalStatus: { coding: [{ code: 'active' }] },
        code: { text: 'CKD stage 4' },
        subject: { reference: 'Patient/abc-123' },
      },
    },
  ],
};

describe('loadPatientBundle', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('aggregates Patient + MedicationRequest + Observation + Condition into a unified bundle', async () => {
    globalThis.fetch = mockFetchSequence([
      fhirResponse(samplePatient),
      fhirResponse(sampleMedsBundle),
      fhirResponse(sampleObsBundle),
      fhirResponse(sampleCondBundle),
    ]) as unknown as typeof fetch;

    const client = new FHIRClient();
    client.connect('https://fhir.example.com', 'tok-abc');

    const bundle = await loadPatientBundle(client, 'abc-123');

    expect(bundle.patient.id).toBe('abc-123');
    expect(bundle.medications).toHaveLength(1);
    expect(bundle.medications[0].medicationCodeableConcept?.text).toBe('Metformin 1000mg');
    expect(bundle.observations).toHaveLength(2);
    expect(bundle.conditions).toHaveLength(1);
    // Derived scalars should pull from the latest observation matching the LOINC.
    expect(bundle.egfr).toBe(28);
    expect(bundle.age).toBeGreaterThan(70);
  });

  it('degrades gracefully when one of the queries fails', async () => {
    // Patient succeeds; meds 4xx (not retried); observations succeed; conditions succeed.
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fhirResponse(samplePatient));
    fetchMock.mockResolvedValueOnce(fhirResponse({ issue: [{ diagnostics: 'forbidden' }] }, 403));
    fetchMock.mockResolvedValueOnce(fhirResponse(sampleObsBundle));
    fetchMock.mockResolvedValueOnce(fhirResponse(sampleCondBundle));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new FHIRClient();
    client.connect('https://fhir.example.com', 'tok-abc');

    const bundle = await loadPatientBundle(client, 'abc-123');
    expect(bundle.patient.id).toBe('abc-123');
    // The failed sub-query degrades to an empty array; bundle still usable.
    expect(bundle.medications).toEqual([]);
    expect(bundle.observations).toHaveLength(2);
  });

  it('propagates an error when the Patient fetch itself fails', async () => {
    globalThis.fetch = mockFetchSequence([
      fhirResponse({ issue: [{ diagnostics: 'patient not found' }] }, 404),
    ]) as unknown as typeof fetch;

    const client = new FHIRClient();
    client.connect('https://fhir.example.com', 'tok-abc');

    await expect(loadPatientBundle(client, 'missing')).rejects.toMatchObject({
      name: 'FHIRError',
      status: 404,
    });
  });
});

describe('loadPatientObservations', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches observations using a date=ge filter derived from sinceDays', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fhirResponse(sampleObsBundle));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new FHIRClient();
    client.connect('https://fhir.example.com', 'tok-abc');

    const observations = await loadPatientObservations(client, 'abc-123', 30);
    expect(observations).toHaveLength(2);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/Observation?');
    expect(calledUrl).toContain('patient=abc-123');
    expect(calledUrl).toMatch(/date=ge\d{4}-\d{2}-\d{2}/);
  });
});

describe('FHIRClient hardening', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries once on 5xx then succeeds', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fhirResponse({ issue: [{ diagnostics: 'svc unavailable' }] }, 503));
    fetchMock.mockResolvedValueOnce(fhirResponse(samplePatient));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new FHIRClient();
    client.connect('https://fhir.example.com', 'tok-abc');

    const patient = await client.getPatient('abc-123');
    expect(patient.id).toBe('abc-123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx (would amplify caller errors)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fhirResponse({ issue: [{ diagnostics: 'forbidden' }] }, 403)
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new FHIRClient();
    client.connect('https://fhir.example.com', 'tok-abc');

    await expect(client.getPatient('abc-123')).rejects.toBeInstanceOf(FHIRError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a hung request on timeout', async () => {
    // fetch that never resolves until aborted (mimics a hung FHIR server)
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new FHIRClient();
    client.connect('https://fhir.example.com', 'tok-abc', 50); // 50ms timeout for fast test

    await expect(client.getPatient('abc-123')).rejects.toMatchObject({
      name: 'FHIRError',
      status: 0,
    });
  });
});
