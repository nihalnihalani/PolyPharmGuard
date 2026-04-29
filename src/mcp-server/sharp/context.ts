import { AsyncLocalStorage } from 'node:async_hooks';
import type { FHIRContextHeaders } from '../../types/mcp.js';

/**
 * Per-request store carrying SHARP-extracted FHIR context for the duration
 * of a single MCP HTTP request. Stdio transport leaves this empty and falls
 * back to env-var resolution, preserving existing local-dev behavior.
 */
const sharpContextStore = new AsyncLocalStorage<FHIRContextHeaders>();

/**
 * Run a function with the given SHARP context active. Anything called inside
 * the callback (including tool handlers downstream) can retrieve it via
 * {@link getActiveSHARPContext}.
 */
export function runWithSHARPContext<T>(
  ctx: FHIRContextHeaders | null,
  fn: () => Promise<T> | T
): Promise<T> | T {
  if (!ctx) return fn();
  return sharpContextStore.run(ctx, fn);
}

/**
 * Returns the SHARP context attached to the currently executing request, or
 * null if none was supplied (e.g., stdio transport).
 */
export function getActiveSHARPContext(): FHIRContextHeaders | null {
  return sharpContextStore.getStore() ?? null;
}

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

  // Prefer explicit arg; otherwise fall back to AsyncLocalStorage populated by
  // the HTTP transport when SHARP headers are present on the inbound request.
  const sharp = sharpContext ?? getActiveSHARPContext();
  if (sharp) return sharp;

  const envUrl = process.env['FHIR_SERVER_URL'];
  const envToken = process.env['FHIR_ACCESS_TOKEN'];
  const envPatient = toolInput.patientId ?? process.env['PATIENT_ID'];

  if (envUrl && envToken && envPatient) {
    return { fhirServerUrl: envUrl, accessToken: envToken, patientId: envPatient };
  }

  return null;
}
