// No /g flag on these — global regex patterns with /g are stateful (lastIndex mutates
// between .test() calls), which causes every other call to return false even when
// credentials are present, creating a credential-leak vulnerability.
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._~+/\-]+=*/;
const URL_WITH_CREDENTIALS_PATTERN = /https?:\/\/[^:@\s]+:[^@\s]+@[^\s]*/;
const JWT_PATTERN = /ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const LONG_TOKEN_PATTERN = /ey[A-Za-z0-9_-]{50,}/;
// Replace patterns keep /g so all occurrences are substituted in a single pass
const BEARER_TOKEN_REPLACE = /Bearer\s+[A-Za-z0-9._~+/\-]+=*/g;
const URL_WITH_CREDENTIALS_REPLACE = /https?:\/\/[^:@\s]+:[^@\s]+@[^\s]*/g;
const JWT_REPLACE = /ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const LONG_TOKEN_REPLACE = /ey[A-Za-z0-9_-]{50,}/g;

// No /g flag — these are used with .test() which is stateful with /g (lastIndex advances,
// causing alternating true/false on repeated calls). /i alone gives case-insensitive matching.
const UNSUPPORTED_CLAIM_PATTERNS = [
  /studies show(?!\s+\[source:)/i,
  /research indicates(?!\s+\[source:)/i,
  /it is well known(?!\s+\[source:)/i,
  /evidence suggests(?!\s+\[source:)/i,
];

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

export function validateClinicalOutput(output: string, _inputMeds: string[] = []): ValidationResult {
  const warnings: string[] = [];

  for (const pattern of UNSUPPORTED_CLAIM_PATTERNS) {
    if (pattern.test(output)) {
      warnings.push(`Unsupported claim detected (missing citation): "${pattern.source}"`);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

export function ensureNoFHIRCredentials(prompt: string): string {
  let sanitized = prompt;
  let stripped = false;

  if (BEARER_TOKEN_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(BEARER_TOKEN_REPLACE, 'Bearer [REDACTED]');
    stripped = true;
  }

  if (URL_WITH_CREDENTIALS_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(URL_WITH_CREDENTIALS_REPLACE, '[REDACTED_URL]');
    stripped = true;
  }

  if (JWT_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(JWT_REPLACE, '[JWT_REDACTED]');
    stripped = true;
  }

  if (LONG_TOKEN_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(LONG_TOKEN_REPLACE, '[TOKEN_REDACTED]');
    stripped = true;
  }

  if (stripped) {
    console.error('[PolyPharmGuard] WARNING: Credentials detected and stripped from LLM prompt');
  }

  return sanitized;
}
