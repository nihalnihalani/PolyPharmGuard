import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
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
const ALLOWED_ORIGIN = process.env['A2A_ALLOWED_ORIGIN'] ?? '*';
const MAX_BODY_BYTES = parsePositiveInt(process.env['A2A_MAX_BODY_BYTES'], 1024 * 1024);

class RequestBodyTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} byte limit`);
    this.name = 'RequestBodyTooLargeError';
  }
}

type A2ATaskPayload = {
  id?: string;
  message?: { parts?: Array<{ data?: unknown }>; data?: unknown };
  params?: { parts?: Array<{ data?: unknown }>; data?: unknown };
  data?: unknown;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        rejected = true;
        reject(new RequestBodyTooLargeError(maxBodyBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}

function sendJSON(res: ServerResponse, statusCode: number, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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

  // Per-request structured log (matches mcp-http format) — see http-transport.ts
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID().slice(0, 8);
  const start = Date.now();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
  res.on('finish', () => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'a2a',
      reqId: requestId,
      method: req.method,
      path: url.pathname,
      status: res.statusCode,
      durMs: Date.now() - start,
    }));
  });

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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
      const contentLength = Number.parseInt(req.headers['content-length'] ?? '0', 10);
      if (contentLength > MAX_BODY_BYTES) {
        sendJSON(res, 413, {
          status: { state: 'failed', message: `Request body too large. Limit is ${MAX_BODY_BYTES} bytes.` },
        });
        return;
      }

      const body = await getBody(req, MAX_BODY_BYTES);
      let task: A2ATaskPayload;
      try {
        task = JSON.parse(body) as A2ATaskPayload;
      } catch {
        sendJSON(res, 400, {
          status: { state: 'failed', message: 'Invalid JSON request body' },
        });
        return;
      }
      const taskId = task.id ?? `task-${Date.now()}`;

      // Extract patient data from task message
      const message = task.message ?? task.params ?? {};
      const inputData = (message.parts?.[0]?.data ?? message.data ?? message) as Record<string, unknown>;

      const sharpContext = extractSHARPHeaders(req);

      const reviewRequest = {
        patientId: inputData.patientId as string | undefined,
        patient: inputData.patient as FHIRPatient | undefined,
        medications: inputData.medications as FHIRMedicationRequest[] | undefined,
        observations: inputData.observations as FHIRObservation[] | undefined,
        conditions: inputData.conditions as FHIRCondition[] | undefined,
        genotypes: inputData.genotypes as Record<string, string> | undefined,
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
      const e = err as Error;
      if (err instanceof RequestBodyTooLargeError) {
        sendJSON(res, 413, {
          status: { state: 'failed', message: `Request body too large. Limit is ${err.limitBytes} bytes.` },
        });
        return;
      }
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        svc: 'a2a',
        level: 'error',
        reqId: requestId,
        msg: 'task processing error',
        error: e.message,
        stack: e.stack,
      }));
      sendJSON(res, 500, {
        status: { state: 'failed', message: e.message },
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
