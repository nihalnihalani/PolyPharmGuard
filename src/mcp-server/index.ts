import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initGemini } from '../llm/gemini.js';
import { analyzeCascadeInteractions } from './tools/cascade-interactions.js';
import { checkOrganFunctionDosing } from './tools/organ-function-dosing.js';
import { screenDeprescribing } from './tools/deprescribing-screen.js';
import { resolveFHIRContext } from './sharp/context.js';
import { FHIRClient } from '../fhir/client.js';
import { getPatientContext } from '../fhir/queries.js';

const FHIRContextSchema = z.object({
  fhirServerUrl: z.string().describe('FHIR server base URL'),
  accessToken: z.string().describe('Bearer token for FHIR API authorization'),
  patientId: z.string().describe('Patient identifier'),
}).optional();

const server = new McpServer({
  name: 'polypharmguard',
  version: '1.0.0',
});

// Tool 1: analyze_cascade_interactions
server.tool(
  'analyze_cascade_interactions',
  'Detect multi-drug CYP450 pharmacokinetic cascade interactions that pairwise checkers miss. Analyzes medication lists against FDA CYP450 knowledge base with clinical AI reasoning. Returns ranked findings with full evidence chains and citations.',
  {
    medications: z.array(z.string()).describe('List of medication names to analyze (e.g., ["Fluconazole 200mg", "Simvastatin 40mg"])'),
    patientId: z.string().optional().describe('FHIR Patient ID for clinical context enrichment (eGFR, conditions)'),
    fhirContext: FHIRContextSchema.describe('Explicit FHIR connection context (alternative to SHARP headers or environment variables)'),
  },
  async (input) => {
    let patientCtx = null;

    const fhirCtx = resolveFHIRContext(input, null);
    if (fhirCtx) {
      try {
        const client = new FHIRClient();
        client.connect(fhirCtx.fhirServerUrl, fhirCtx.accessToken);
        patientCtx = await getPatientContext(client, fhirCtx.patientId);
      } catch (err) {
        console.error('[MCP] FHIR context fetch failed:', (err as Error).message);
      }
    }

    const findings = await analyzeCascadeInteractions({
      medications: input.medications,
      patientContext: patientCtx,
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          findings,
          medicationsAnalyzed: input.medications.length,
          cascadesDetected: findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    };
  }
);

// Tool 2: check_organ_function_dosing
server.tool(
  'check_organ_function_dosing',
  'Cross-reference each medication\'s dosing requirements against the patient\'s current renal (eGFR) and hepatic (ALT/AST/bilirubin) function. Flags medications that are contraindicated or require dose adjustment at the patient\'s current organ function level.',
  {
    medications: z.array(z.string()).describe('List of medication names with doses (e.g., ["Metformin 1000mg BID", "Gabapentin 300mg TID"])'),
    patientId: z.string().optional().describe('FHIR Patient ID for lab value retrieval'),
    fhirContext: FHIRContextSchema.describe('Explicit FHIR connection context'),
  },
  async (input) => {
    let patientCtx = null;

    const fhirCtx = resolveFHIRContext(input, null);
    if (fhirCtx) {
      try {
        const client = new FHIRClient();
        client.connect(fhirCtx.fhirServerUrl, fhirCtx.accessToken);
        patientCtx = await getPatientContext(client, fhirCtx.patientId);
      } catch (err) {
        console.error('[MCP] FHIR context fetch failed:', (err as Error).message);
      }
    }

    const findings = await checkOrganFunctionDosing({
      medications: input.medications,
      patientContext: patientCtx,
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          findings,
          medicationsAnalyzed: input.medications.length,
          adjustmentsNeeded: findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    };
  }
);

// Tool 3: screen_deprescribing
server.tool(
  'screen_deprescribing',
  'Identify medications that should be considered for discontinuation based on AGS 2023 Beers Criteria and STOPPFrail guidelines. Returns prioritized recommendations with evidence-based tapering schedules.',
  {
    medications: z.array(z.string()).describe('List of medication names to screen'),
    patientId: z.string().optional().describe('FHIR Patient ID for demographic and condition context'),
    fhirContext: FHIRContextSchema.describe('Explicit FHIR connection context'),
    patientAge: z.number().optional().describe('Patient age in years (alternative to FHIR lookup)'),
  },
  async (input) => {
    let patientCtx = null;

    const fhirCtx = resolveFHIRContext(input, null);
    if (fhirCtx) {
      try {
        const client = new FHIRClient();
        client.connect(fhirCtx.fhirServerUrl, fhirCtx.accessToken);
        patientCtx = await getPatientContext(client, fhirCtx.patientId);
      } catch (err) {
        console.error('[MCP] FHIR context fetch failed:', (err as Error).message);
      }
    }

    const findings = await screenDeprescribing({
      medications: input.medications,
      patientContext: patientCtx,
      patientAge: input.patientAge,
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          findings,
          medicationsScreened: input.medications.length,
          candidatesFound: findings.filter(f => f.severity === 'HIGH' || f.severity === 'MODERATE').length,
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    };
  }
);

async function main() {
  const geminiKey = process.env['GEMINI_API_KEY'];
  if (geminiKey) {
    initGemini(geminiKey);
    console.error('[PolyPharmGuard] Gemini AI initialized (gemini-2.0-flash)');
  } else {
    console.error('[PolyPharmGuard] WARNING: GEMINI_API_KEY not set. Running in KB-only mode (no LLM reasoning).');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[PolyPharmGuard] MCP Server running on stdio. Tools: analyze_cascade_interactions, check_organ_function_dosing, screen_deprescribing');
}

main().catch((err) => {
  console.error('[PolyPharmGuard] Fatal error:', err);
  process.exit(1);
});
