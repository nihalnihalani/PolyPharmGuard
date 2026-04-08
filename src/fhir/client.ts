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

export class FHIRClient {
  private serverUrl: string = '';
  private accessToken: string = '';
  private connected: boolean = false;

  toJSON() {
    return { serverUrl: this.serverUrl, connected: this.connected };
  }

  connect(serverUrl: string, accessToken: string): void {
    try {
      new URL(serverUrl);
    } catch {
      throw new Error(`Invalid FHIR server URL: ${serverUrl}`);
    }
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.accessToken = accessToken;
    this.connected = true;
  }

  private async fhirGet<T>(path: string): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/fhir+json',
        },
      });
    } catch (err) {
      throw new FHIRError(0, `Network error connecting to FHIR server: ${(err as Error).message}`, url);
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

  async getConditions(patientId: string): Promise<FHIRCondition[]> {
    const bundle = await this.fhirGet<FHIRBundle<FHIRCondition>>(
      `/Condition?patient=${encodeURIComponent(patientId)}&clinical-status=active&_count=100`
    );
    return (bundle.entry ?? []).map(e => e.resource);
  }
}
