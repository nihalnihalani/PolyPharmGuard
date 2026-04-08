import type { FHIRContextHeaders } from '../../types/mcp.js';

export function extractSHARPContext(headers: Record<string, string | undefined>): FHIRContextHeaders | null {
  const normalize = (key: string) => {
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  };

  const fhirServerUrl = normalize('x-fhir-server-url');
  const accessToken = normalize('x-fhir-access-token');
  const patientId = normalize('x-patient-id');

  if (!fhirServerUrl || !accessToken || !patientId) return null;
  return { fhirServerUrl, accessToken, patientId };
}

export function resolveFHIRContext(
  toolInput: { patientId?: string; fhirContext?: FHIRContextHeaders },
  sharpContext: FHIRContextHeaders | null
): FHIRContextHeaders | null {
  if (toolInput.fhirContext) return toolInput.fhirContext;

  if (sharpContext) return sharpContext;

  const envUrl = process.env['FHIR_SERVER_URL'];
  const envToken = process.env['FHIR_ACCESS_TOKEN'];
  const envPatient = toolInput.patientId ?? process.env['PATIENT_ID'];

  if (envUrl && envToken && envPatient) {
    return { fhirServerUrl: envUrl, accessToken: envToken, patientId: envPatient };
  }

  return null;
}
