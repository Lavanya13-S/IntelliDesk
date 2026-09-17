/**
 * lib/sanitize.ts
 *
 * Sanitization utilities for Knowledge Base article generation.
 * Strips sensitive data before storing anything in the KB.
 *
 * NEVER stores: passwords, credentials, temp passwords, license keys,
 * VPN secrets, API keys, tokens, or any sensitive information.
 */

// ─── Sensitive data patterns ──────────────────────────────────────────────────

const SENSITIVE_PATTERNS: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  // Passwords (various formats)
  {
    label: 'password',
    pattern: /(?:password|passwd|pwd|pass)\s*[:=]\s*\S+/gi,
    replacement: '[PASSWORD REDACTED]',
  },
  // Temporary passwords
  {
    label: 'temp_password',
    pattern: /(?:temp(?:orary)?\s*(?:password|passwd|pwd)|initial\s*password)\s*[:=]\s*\S+/gi,
    replacement: '[TEMP PASSWORD REDACTED]',
  },
  // API keys (long alphanumeric strings 20+ chars with optional dashes/underscores)
  {
    label: 'api_key',
    pattern: /(?:api[_-]?key|apikey|api[_-]?token|access[_-]?key)\s*[:=]\s*[\w\-]{20,}/gi,
    replacement: '[API KEY REDACTED]',
  },
  // Generic bearer / OAuth tokens
  {
    label: 'bearer_token',
    pattern: /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer [TOKEN REDACTED]',
  },
  // License keys (XXXXX-XXXXX-XXXXX pattern, 5+ groups)
  {
    label: 'license_key',
    pattern: /\b[A-Z0-9]{4,6}(?:-[A-Z0-9]{4,6}){3,}\b/g,
    replacement: '[LICENSE KEY REDACTED]',
  },
  // VPN secrets / PSKs
  {
    label: 'vpn_secret',
    pattern: /(?:vpn[_-]?(?:secret|psk|key|password)|pre[_-]?shared[_-]?key)\s*[:=]\s*\S+/gi,
    replacement: '[VPN SECRET REDACTED]',
  },
  // Connection strings / DSNs
  {
    label: 'connection_string',
    pattern: /(?:connection[_-]?string|datasource|jdbc:[^\s]+|mongodb\+srv:\/\/[^\s]+)/gi,
    replacement: '[CONNECTION STRING REDACTED]',
  },
  // AWS / cloud credentials
  {
    label: 'aws_key',
    pattern: /(?:AKIA|ASIA|AROA)[A-Z0-9]{16}/g,
    replacement: '[AWS KEY REDACTED]',
  },
  // Private keys (PEM headers)
  {
    label: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replacement: '[PRIVATE KEY REDACTED]',
  },
  // Email credentials format  "user:password@host"
  {
    label: 'email_credential',
    pattern: /\b[\w.+%-]+:(?=[^@\s]*@)[^\s@]+@[\w.%-]+\b/g,
    replacement: '[CREDENTIAL REDACTED]',
  },
  // Hashed passwords (bcrypt, argon2, sha256, etc.)
  {
    label: 'hash',
    pattern: /\$2[ayb]\$\d{2}\$[./A-Za-z0-9]{53}/g,
    replacement: '[HASH REDACTED]',
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sanitize a string for storage in the Knowledge Base.
 * Replaces all detected sensitive patterns with labeled redaction placeholders.
 */
export function sanitizeForKnowledgeBase(text: string): string {
  if (!text) return text;
  let sanitized = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * Check whether a string contains any sensitive data.
 * Useful for pre-send validation.
 */
export function containsSensitiveData(text: string): { found: boolean; labels: string[] } {
  if (!text) return { found: false, labels: [] };
  const foundLabels: string[] = [];
  for (const { label, pattern } of SENSITIVE_PATTERNS) {
    if (new RegExp(pattern.source, pattern.flags).test(text)) {
      foundLabels.push(label);
    }
  }
  return { found: foundLabels.length > 0, labels: foundLabels };
}
