/**
 * Publish PolyPharmGuard to the Prompt Opinion Marketplace.
 *
 * What this script does:
 *   1. Loads marketplace.yaml from the repo root.
 *   2. Validates that PROMPT_OPINION_API_KEY is set.
 *   3. POSTs the manifest to the Prompt Opinion publish API.
 *
 * The exact publish endpoint and payload shape for the Prompt Opinion
 * Marketplace API could not be confirmed from inside the build sandbox
 * (no outbound network access). We default to the convention used by the
 * po-community-mcp reference repo:
 *
 *     POST https://app.promptopinion.ai/api/v1/marketplace/entries
 *     Authorization: Bearer ${PROMPT_OPINION_API_KEY}
 *     Content-Type: application/yaml
 *     <body: marketplace.yaml>
 *
 * Override either via env if the production URL/path differs:
 *   PROMPT_OPINION_API_URL=https://app.promptopinion.ai
 *   PROMPT_OPINION_PUBLISH_PATH=/api/v1/marketplace/entries
 *
 * On any 4xx/5xx the script prints the raw response and exits non-zero so
 * the operator can fall back to the manual UI flow documented in
 * docs/marketplace-deployment.md.
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(ROOT, 'marketplace.yaml');

function fail(msg: string): never {
  console.error(`[publish:po] ${msg}`);
  process.exit(1);
}

async function main() {
  const apiKey = process.env['PROMPT_OPINION_API_KEY'];
  if (!apiKey) {
    fail('PROMPT_OPINION_API_KEY is not set. Add it to .env or export it.');
  }

  if (!existsSync(MANIFEST_PATH)) {
    fail(`marketplace.yaml not found at ${MANIFEST_PATH}`);
  }

  const manifest = readFileSync(MANIFEST_PATH, 'utf-8');
  const baseUrl = process.env['PROMPT_OPINION_API_URL'] ?? 'https://app.promptopinion.ai';
  const path = process.env['PROMPT_OPINION_PUBLISH_PATH'] ?? '/api/v1/marketplace/entries';
  const url = new URL(path, baseUrl).toString();

  console.error(`[publish:po] POST ${url}`);
  console.error(`[publish:po] manifest: ${MANIFEST_PATH} (${manifest.length} bytes)`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/yaml',
        'Accept': 'application/json',
      },
      body: manifest,
    });
  } catch (err) {
    fail(`Network error contacting Prompt Opinion: ${(err as Error).message}\n` +
      `Fallback: register manually at ${baseUrl} per docs/marketplace-deployment.md.`);
  }

  const text = await res.text();
  if (!res.ok) {
    console.error(`[publish:po] HTTP ${res.status} ${res.statusText}`);
    console.error(`[publish:po] response: ${text}`);
    fail(
      `Publish failed. If this endpoint is wrong (it could not be verified at ` +
      `build time), set PROMPT_OPINION_API_URL / PROMPT_OPINION_PUBLISH_PATH or ` +
      `register manually via the UI per docs/marketplace-deployment.md.`
    );
  }

  console.error(`[publish:po] OK — HTTP ${res.status}`);
  console.error(text);
}

main().catch((err) => {
  console.error('[publish:po] Fatal:', err);
  process.exit(1);
});
