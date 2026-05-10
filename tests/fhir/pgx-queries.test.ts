import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FHIRClient } from '../../src/fhir/client.js';
import { loadPatientGenotypes, normalizePhenotype } from '../../src/fhir/pgx-queries.js';

function fhirOk(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const sampleObsBundle = (entries: unknown[]) => ({
  resourceType: 'Bundle',
  type: 'searchset',
  entry: entries.map(resource => ({ resource })),
});

const cyp2d6PoorObservation = {
  resourceType: 'Observation',
  id: 'obs-pgx-d6',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '54091-9', display: 'CYP2D6 phenotype' }] },
  subject: { reference: 'Patient/abc-123' },
  valueCodeableConcept: { text: 'Poor Metabolizer' },
};

const cyp2c19IntermediateObservation = {
  resourceType: 'Observation',
  id: 'obs-pgx-c19',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '79716-7', display: 'CYP2C19 phenotype' }] },
  subject: { reference: 'Patient/abc-123' },
  valueCodeableConcept: { text: 'Intermediate Metabolizer' },
};

const cyp2c9NormalObservation = {
  resourceType: 'Observation',
  id: 'obs-pgx-c9',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '81244-7', display: 'CYP2C9 phenotype' }] },
  subject: { reference: 'Patient/abc-123' },
  valueString: 'Normal Metabolizer (*1/*1)',
};

const garbagePhenotypeObservation = {
  resourceType: 'Observation',
  id: 'obs-pgx-bad',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '54091-9' }] },
  subject: { reference: 'Patient/abc-123' },
  valueCodeableConcept: { text: 'Wibble' },
};

describe('normalizePhenotype', () => {
  it('maps poor / PM / nonfunctional → poor_metabolizer', () => {
    expect(normalizePhenotype('Poor Metabolizer')).toBe('poor_metabolizer');
    expect(normalizePhenotype('PM')).toBe('poor_metabolizer');
    expect(normalizePhenotype('nonfunctional allele')).toBe('poor_metabolizer');
  });
  it('maps ultrarapid / UM variants', () => {
    expect(normalizePhenotype('Ultra-Rapid Metabolizer')).toBe('ultrarapid_metabolizer');
    expect(normalizePhenotype('UM')).toBe('ultrarapid_metabolizer');
    expect(normalizePhenotype('ultrarapid metabolizer')).toBe('ultrarapid_metabolizer');
  });
  it('maps intermediate / IM', () => {
    expect(normalizePhenotype('Intermediate Metabolizer')).toBe('intermediate_metabolizer');
    expect(normalizePhenotype('IM')).toBe('intermediate_metabolizer');
  });
  it('maps normal / extensive / wild-type / *1/*1', () => {
    expect(normalizePhenotype('Normal Metabolizer (*1/*1)')).toBe('normal_metabolizer');
    expect(normalizePhenotype('Extensive Metabolizer')).toBe('normal_metabolizer');
    expect(normalizePhenotype('wild type')).toBe('normal_metabolizer');
  });
  it('returns null for unknown phenotype text', () => {
    expect(normalizePhenotype('Wibble')).toBeNull();
    expect(normalizePhenotype('')).toBeNull();
  });
});

describe('loadPatientGenotypes', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('aggregates CYP2D6, CYP2C19, CYP2C9 phenotypes from FHIR Observations', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fhirOk(sampleObsBundle([cyp2d6PoorObservation, cyp2c19IntermediateObservation, cyp2c9NormalObservation]))
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new FHIRClient();
    client.connect('https://hapi.example/baseR4', 'token');
    const genotypes = await loadPatientGenotypes(client, 'abc-123');

    expect(genotypes).toEqual({
      CYP2D6: 'poor_metabolizer',
      CYP2C19: 'intermediate_metabolizer',
      CYP2C9: 'normal_metabolizer',
    });
  });

  it('drops Observations with unrecognized phenotype text and warns', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      fhirOk(sampleObsBundle([garbagePhenotypeObservation, cyp2c19IntermediateObservation]))
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = new FHIRClient();
    client.connect('https://hapi.example/baseR4', 'token');
    const genotypes = await loadPatientGenotypes(client, 'abc-123');

    // CYP2C19 still parsed; CYP2D6 garbage dropped
    expect(genotypes).toEqual({ CYP2C19: 'intermediate_metabolizer' });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns empty record without throwing when FHIR fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = new FHIRClient();
    client.connect('https://hapi.example/baseR4', 'token');
    const genotypes = await loadPatientGenotypes(client, 'abc-123');

    expect(genotypes).toEqual({});
  });
});
