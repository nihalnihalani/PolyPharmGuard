/**
 * Streamable HTTP transport for the PolyPharmGuard MCP server.
 *
 * Wraps the MCP SDK's StreamableHTTPServerTransport behind a thin Node http
 * server so the same McpServer instance that's used over stdio in dev can be
 * exposed publicly for the Prompt Opinion Marketplace. Adds:
 *   - GET /health        — liveness probe (used by Docker/Cloud Run/etc.)
 *   - GET /              — service banner (helps humans verify the URL works)
 *   - ALL /mcp           — MCP Streamable HTTP endpoint (POST/GET/DELETE)
 *
 * SHARP context propagation:
 *   FHIR credentials arrive as request headers (X-FHIR-Server-URL,
 *   X-FHIR-Access-Token, X-Patient-ID). They are extracted via
 *   extractSHARPContext() and pushed onto an AsyncLocalStorage so that any
 *   tool handler executed inside this request can recover them via
 *   resolveFHIRContext(). Credentials never appear in LLM prompts.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { extractSHARPContext, runWithSHARPContext } from './sharp/context.js';

export interface HttpTransportOptions {
  /** TCP port to listen on. Defaults to env MCP_PORT or 3000. */
  port?: number;
  /** Host/interface to bind. Defaults to 0.0.0.0 (so containers work). */
  host?: string;
  /** Override service name reported by /health. */
  serviceName?: string;
  /** Override service version reported by /health. */
  serviceVersion?: string;
}

/**
 * Reads the request body into a Buffer. The MCP SDK's handleRequest accepts a
 * pre-parsed body, but we let the SDK do its own JSON parsing for correctness
 * and only buffer here so we can pass the raw bytes through.
 */
function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function writeCorsPreflight(res: ServerResponse): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Mcp-Session-Id, X-FHIR-Server-URL, X-FHIR-Access-Token, X-Patient-ID, Authorization',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  });
  res.end();
}

/**
 * Starts the Streamable HTTP transport and binds it to the given McpServer.
 * Resolves once the server is listening; the returned handle exposes close()
 * for graceful shutdown in tests or signal handlers.
 */
export async function startHttpTransport(
  server: McpServer,
  options: HttpTransportOptions = {}
): Promise<{ close: () => Promise<void>; port: number }> {
  const port = options.port ?? parseInt(process.env['MCP_PORT'] ?? '3000', 10);
  const host = options.host ?? '0.0.0.0';
  const serviceName = options.serviceName ?? 'polypharmguard';
  const serviceVersion = options.serviceVersion ?? '1.0.0';

  // Stateful Streamable HTTP transport: the SDK manages session IDs and
  // SSE streams. randomUUID gives us cryptographically-strong session IDs.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // Wire the transport to the McpServer. This must be done before requests
  // arrive — connect() is idempotent across calls but we only call it once.
  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${port}`}`);

    // CORS preflight — needed for marketplace UI that probes from a browser.
    if (req.method === 'OPTIONS') {
      writeCorsPreflight(res);
      return;
    }

    // Liveness probe.
    if (req.method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, {
        status: 'ok',
        service: serviceName,
        version: serviceVersion,
        transport: 'streamable-http',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Human-readable banner at root so a browser visit confirms the URL.
    if (req.method === 'GET' && url.pathname === '/') {
      writeJson(res, 200, {
        service: serviceName,
        version: serviceVersion,
        protocol: 'mcp/streamable-http',
        endpoints: {
          mcp: '/mcp',
          health: '/health',
        },
      });
      return;
    }

    // MCP protocol endpoint — POST (JSON-RPC), GET (SSE), DELETE (session end).
    if (url.pathname === '/mcp') {
      try {
        const sharp = extractSHARPContext(req.headers as Record<string, string | undefined>);

        // For POST we read the body up front so the SDK can parse it (avoids
        // consuming the stream twice if the SDK retries).
        let parsedBody: unknown = undefined;
        if (req.method === 'POST') {
          const raw = await readRequestBody(req);
          if (raw.length > 0) {
            try {
              parsedBody = JSON.parse(raw.toString('utf-8'));
            } catch {
              writeJson(res, 400, {
                jsonrpc: '2.0',
                error: { code: -32700, message: 'Parse error: invalid JSON' },
                id: null,
              });
              return;
            }
          }
        }

        // Run the entire MCP request handler — including tool callbacks the
        // SDK invokes synchronously from message dispatch — inside the SHARP
        // ALS scope. resolveFHIRContext() picks it up downstream.
        await runWithSHARPContext(sharp, async () => {
          await transport.handleRequest(req, res, parsedBody);
        });
      } catch (err) {
        console.error('[MCP-HTTP] handleRequest failed:', err);
        if (!res.headersSent) {
          writeJson(res, 500, {
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          });
        }
      }
      return;
    }

    writeJson(res, 404, { error: 'Not found', path: url.pathname });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  console.error(`[PolyPharmGuard] MCP Server (HTTP) listening on http://${host}:${port}`);
  console.error(`[PolyPharmGuard] MCP endpoint: http://${host}:${port}/mcp`);
  console.error(`[PolyPharmGuard] Health: http://${host}:${port}/health`);

  return {
    port,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await transport.close();
    },
  };
}
