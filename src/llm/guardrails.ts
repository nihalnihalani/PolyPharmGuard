const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._~+/\-]+=*/g;
const URL_WITH_CREDENTIALS_PATTERN = /https?:\/\/[^:@\s]+:[^@\s]+@[^\s]*/g;
const JWT_PATTERN = /ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const LONG_TOKEN_PATTERN = /ey[A-Za-z0-9_-]{50,}/g;

const UNSUPPORTED_CLAIM_PATTERNS = [
  /studies show(?!\s+\[source:)/gi,
  /research indicates(?!\s+\[source:)/gi,
  /it is well known(?!\s+\[source:)/gi,
  /evidence suggests(?!\s+\[source:)/gi,
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
    sanitized = sanitized.replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]');
    stripped = true;
  }

  if (URL_WITH_CREDENTIALS_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(URL_WITH_CREDENTIALS_PATTERN, '[REDACTED_URL]');
    stripped = true;
  }

  if (JWT_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(JWT_PATTERN, '[JWT_REDACTED]');
    stripped = true;
  }

  if (LONG_TOKEN_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(LONG_TOKEN_PATTERN, '[TOKEN_REDACTED]');
    stripped = true;
  }

  if (stripped) {
    console.error('[PolyPharmGuard] WARNING: Credentials detected and stripped from LLM prompt');
  }

  return sanitized;
}
