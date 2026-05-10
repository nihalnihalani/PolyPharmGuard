import type { FHIRPatient, FHIRMedicationRequest, FHIRObservation, FHIRCondition, FHIRBundle } from '../types/fhir.js';

export class FHIRError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly url: string
  ) {
    super(message);
    this.name = 'FHIRError';
  }
}

// Per-request defaults. Overridable via env or per-instance via connect().
// FHIR_REQUEST_TIMEOUT_MS is the per-request abort window. The legacy
// FHIR_TIMEOUT_MS env var is honored as a fallback so we don't break existing
// deployments.
const DEFAULT_TIMEOUT_MS = 5_000;

// Retry policy: one retry on 5xx with exponential backoff. Two attempts max
// keeps the worst-case latency bounded (timeout + 200ms + timeout = ~10.2s
// at defaults), which is well below the upstream 15s clinical-tool budget.
const RETRY_BACKOFF_MS = [200, 400];

export class FHIRClient {
  private serverUrl: string = '';
  private accessToken: string = '';
  private connected: boolean = false;
  // Resolution order: connect()-supplied timeout → FHIR_REQUEST_TIMEOUT_MS →
  // legacy FHIR_TIMEOUT_MS → DEFAULT_TIMEOUT_MS. The lower default (5s vs the
  // previous 10s) keeps a single FHIR call from blowing past the API budget
  // for an entire review.
  private timeoutMs: number = parsePositiveInt(
    process.env['FHIR_REQUEST_TIMEOUT_MS'] ?? process.env['FHIR_TIMEOUT_MS'],
    DEFAULT_TIMEOUT_MS
  );

  toJSON() {
    return { serverUrl: this.serverUrl, connected: this.connected, timeoutMs: this.timeoutMs };
  }

  connect(serverUrl: string, accessToken: string, timeoutMs?: number): void {
    try {
      new URL(serverUrl);
    } catch {
      throw new Error(`Invalid FHIR server URL: ${serverUrl}`);
    }
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.accessToken = accessToken;
    if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      this.timeoutMs = timeoutMs;
    }
    this.connected = true;
  }

  /**
   * Internal single-attempt fetch. Wraps fetch with a per-request
   * AbortController (5s default) and translates network/parse failures into
   * FHIRError so callers don't have to special-case fetch semantics.
   *
   * Retry orchestration lives in fhirGet (this is just one attempt).
   */
  private async fhirGetOnce<T>(url: string): Promise<T> {
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/fhir+json',
        },
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new FHIRError(0, `FHIR request timed out after ${this.timeoutMs}ms`, url);
      }
      throw new FHIRError(0, `Network error connecting to FHIR server: ${(err as Error).message}`, url);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let message = `FHIR request failed with status ${response.status}`;
      try {
        const outcome = await response.json() as { issue?: Array<{ diagnostics?: string }> };
        if (outcome.issue?.[0]?.diagnostics) {
          message = outcome.issue[0].diagnostics;
        }
      } catch {
        // ignore parse errors
      }
      throw new FHIRError(response.status, message, url);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Public GET helper. Retries once on 5xx with exponential backoff
   * (200ms, 400ms). 4xx responses are NOT retried — those are caller errors
   * (bad patient id, missing scope) and retrying just amplifies the failure.
   */
  private async fhirGet<T>(path: string): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const maxAttempts = RETRY_BACKOFF_MS.length + 1;

    let lastError: FHIRError | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.fhirGetOnce<T>(url);
      } catch (err) {
        const fhirErr = err as FHIRError;
        const isRetryable = fhirErr.status >= 500 && fhirErr.status < 600;
        const hasMoreAttempts = attempt < maxAttempts - 1;
        if (!isRetryable || !hasMoreAttempts) {
          throw fhirErr;
        }
        lastError = fhirErr;
        const backoff = RETRY_BACKOFF_MS[attempt];
        await sleep(backoff);
      }
    }
    // Unreachable in practice — loop either returns or throws — but TypeScript
    // can't see that. Re-throw the last seen error to satisfy the compiler.
    throw lastError ?? new FHIRError(0, 'FHIR request failed without error', url);
  }

  async getPatient(patientId: string): Promise<FHIRPatient> {
    return this.fhirGet<FHIRPatient>(`/Patient/${encodeURIComponent(patientId)}`);
  }

  async getMedications(patientId: string): Promise<FHIRMedicationRequest[]> {
    const bundle = await this.fhirGet<FHIRBundle<FHIRMedicationRequest>>(
      `/MedicationRequest?patient=${encodeURIComponent(patientId)}&status=active&_count=100`
    );
    return (bundle.entry ?? []).map(e => e.resource);
  }

  async getObservations(patientId: string, loincCodes: string[]): Promise<FHIRObservation[]> {
    const codeParam = loincCodes.join(',');
    const bundle = await this.fhirGet<FHIRBundle<FHIRObservation>>(
      `/Observation?patient=${encodeURIComponent(patientId)}&code=${encodeURIComponent(codeParam)}&_sort=-date&_count=20`
    );
    return (bundle.entry ?? []).map(e => e.resource);
  }

  /**
   * Fetch all recent observations for a patient (no LOINC filter), sorted
   * newest-first. Used by lab-monitoring when the caller doesn't pre-load labs:
   * we sweep the last `sinceDays` days and let the tool's KB-backed matching
   * decide which results are clinically relevant per medication.
   *
   * Counts are capped at 200 to bound memory; a polypharmacy patient with
   * weekly INR + monthly chemistry over 6 months stays comfortably under that.
   */
  async getObservationsSince(patientId: string, sinceDays: number = 180): Promise<FHIRObservation[]> {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, Math.floor(sinceDays)));
    const sinceIso = since.toISOString().split('T')[0]; // YYYY-MM-DD
    const bundle = await this.fhirGet<FHIRBundle<FHIRObservation>>(
      `/Observation?patient=${encodeURIComponent(patientId)}&date=ge${sinceIso}&_sort=-date&_count=200`
    );
    return (bundle.entry ?? []).map(e => e.resource);
  }

  async getConditions(patientId: string): Promise<FHIRCondition[]> {
    const bundle = await this.fhirGet<FHIRBundle<FHIRCondition>>(
      `/Condition?patient=${encodeURIComponent(patientId)}&clinical-status=active&_count=100`
    );
    return (bundle.entry ?? []).map(e => e.resource);
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
