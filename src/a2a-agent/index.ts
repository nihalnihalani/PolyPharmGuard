import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMedicationReview } from './orchestrator.js';
import { initGemini } from '../llm/gemini.js';
import type { FHIRMedicationRequest, FHIRObservation, FHIRCondition, FHIRPatient } from '../types/fhir.js';
import type { FHIRContextHeaders } from '../types/mcp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AGENT_CARD = JSON.parse(
  readFileSync(join(__dirname, 'agent-card.json'), 'utf-8')
);

const PORT = parseInt(process.env['A2A_AGENT_PORT'] ?? '8000', 10);

function getBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJSON(res: ServerResponse, statusCode: number, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function extractSHARPHeaders(req: IncomingMessage): FHIRContextHeaders | null {
  const fhirServerUrl = req.headers['x-fhir-server-url'] as string | undefined;
  const accessToken = req.headers['x-fhir-access-token'] as string | undefined;
  const patientId = req.headers['x-patient-id'] as string | undefined;

  if (fhirServerUrl && accessToken && patientId) {
    return { fhirServerUrl, accessToken, patientId };
  }
  return null;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJSON(res, 200, {
      status: 'ok',
      service: 'MedReview Agent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // A2A agent card discovery
  if (req.method === 'GET' && url.pathname === '/.well-known/agent.json') {
    sendJSON(res, 200, AGENT_CARD);
    return;
  }

  // A2A task endpoint
  if (req.method === 'POST' && (url.pathname === '/tasks/send' || url.pathname === '/')) {
    try {
      const body = await getBody(req);
      const task = JSON.parse(body);
      const taskId = task.id ?? `task-${Date.now()}`;

      // Extract patient data from task message
      const message = task.message ?? task.params ?? {};
      const inputData = message.parts?.[0]?.data ?? message.data ?? message;

      const sharpContext = extractSHARPHeaders(req);

      const reviewRequest = {
        patientId: inputData.patientId as string | undefined,
        patient: inputData.patient as FHIRPatient | undefined,
        medications: inputData.medications as FHIRMedicationRequest[] | undefined,
        observations: inputData.observations as FHIRObservation[] | undefined,
        conditions: inputData.conditions as FHIRCondition[] | undefined,
        fhirContext: sharpContext ?? (inputData.fhirContext as FHIRContextHeaders | undefined),
      };

      const report = await runMedicationReview(reviewRequest);

      sendJSON(res, 200, {
        id: taskId,
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [{
          name: 'medication-review-report',
          description: 'PolyPharmGuard 5Ts Medication Review Report',
          parts: [{
            type: 'application/json',
            data: report,
          }],
        }],
      });
    } catch (err) {
      console.error('[A2A] Task processing error:', err);
      sendJSON(res, 500, {
        status: { state: 'failed', message: (err as Error).message },
      });
    }
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

async function main() {
  const geminiKey = process.env['GEMINI_API_KEY'];
  if (geminiKey) {
    initGemini(geminiKey);
    console.error('[MedReview Agent] Gemini AI initialized');
  } else {
    console.error('[MedReview Agent] WARNING: GEMINI_API_KEY not set. Running in KB-only mode.');
  }

  httpServer.listen(PORT, () => {
    console.error(`[MedReview Agent] Running on http://localhost:${PORT}`);
    console.error(`[MedReview Agent] Agent card: http://localhost:${PORT}/.well-known/agent.json`);
    console.error(`[MedReview Agent] Health: http://localhost:${PORT}/health`);
  });
}

main().catch(err => {
  console.error('[MedReview Agent] Fatal error:', err);
  process.exit(1);
});
