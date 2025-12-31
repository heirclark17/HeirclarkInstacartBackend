// src/services/encryption.ts
// AES-256-GCM encryption service for health data, OAuth tokens, and PII
// SOC2 Control: C1.1 Confidentiality | GDPR Article 32 Security

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;        // 96 bits for GCM
const AUTH_TAG_LENGTH = 16;  // 128 bits
const KEY_LENGTH = 32;       // 256 bits

/**
 * Encrypted value storage format
 * Stored as base64 JSON: { iv, data, tag, v }
 */
interface EncryptedPayload {
  iv: string;    // Base64 encoded IV
  data: string;  // Base64 encoded ciphertext
  tag: string;   // Base64 encoded auth tag
  v: number;     // Version for key rotation
}

/**
 * Field contexts for HKDF key derivation
 * Each field type gets its own derived key
 */
export enum FieldContext {
  OAUTH_TOKEN = 'oauth_token',
  REFRESH_TOKEN = 'refresh_token',
  HEALTH_METRICS = 'health_metrics',
  PII = 'pii',
  NUTRITION_DATA = 'nutrition_data',
  WEIGHT_DATA = 'weight_data',
}

// Current key version - increment when rotating keys
const CURRENT_KEY_VERSION = 1;

// Cache derived keys to avoid repeated HKDF operations
const derivedKeyCache = new Map<string, Buffer>();

/**
 * Get and validate the master encryption key from environment
 * @throws Error if key is missing or invalid
 */
function getMasterKey(): Buffer {
  const keyBase64 = process.env.ENCRYPTION_KEY;

  if (!keyBase64) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'Generate with: openssl rand -base64 32'
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(keyBase64, 'base64');
  } catch {
    throw new Error('ENCRYPTION_KEY is not valid base64');
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (got ${key.length}). ` +
      'Generate with: openssl rand -base64 32'
    );
  }

  return key;
}

/**
 * Derive a field-specific key using HKDF
 * This ensures each data type uses a unique encryption key
 */
function deriveKey(context: FieldContext, version: number = CURRENT_KEY_VERSION): Buffer {
  const cacheKey = `${context}:${version}`;

  if (derivedKeyCache.has(cacheKey)) {
    return derivedKeyCache.get(cacheKey)!;
  }

  const masterKey = getMasterKey();
  const info = Buffer.from(`heirclark:${context}:v${version}`, 'utf8');

  // HKDF with SHA-256
  const derivedKey = crypto.hkdfSync(
    'sha256',
    masterKey,
    Buffer.alloc(0), // No salt - master key is already high-entropy
    info,
    KEY_LENGTH
  );

  const keyBuffer = Buffer.from(derivedKey);
  derivedKeyCache.set(cacheKey, keyBuffer);

  return keyBuffer;
}

/**
 * Encrypt a plaintext value using AES-256-GCM
 *
 * @param plaintext - The value to encrypt (string or object)
 * @param context - Field context for key derivation
 * @returns Base64 encoded encrypted payload
 */
export function encrypt(plaintext: string | object, context: FieldContext): string {
  // Convert objects to JSON
  const plaintextStr = typeof plaintext === 'object'
    ? JSON.stringify(plaintext)
    : plaintext;

  if (!plaintextStr || plaintextStr.length === 0) {
    throw new Error('Cannot encrypt empty value');
  }

  const key = deriveKey(context);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintextStr, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: authTag.toString('base64'),
    v: CURRENT_KEY_VERSION,
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decrypt an encrypted value using AES-256-GCM
 *
 * @param encryptedBase64 - Base64 encoded encrypted payload
 * @param context - Field context for key derivation
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails (tampering, wrong key, etc.)
 */
export function decrypt(encryptedBase64: string, context: FieldContext): string {
  if (!encryptedBase64 || encryptedBase64.length === 0) {
    throw new Error('Cannot decrypt empty value');
  }

  let payload: EncryptedPayload;
  try {
    const payloadJson = Buffer.from(encryptedBase64, 'base64').toString('utf8');
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error('Invalid encrypted payload format');
  }

  // Validate payload structure
  if (!payload.iv || !payload.data || !payload.tag || !payload.v) {
    throw new Error('Malformed encrypted payload');
  }

  // Use the key version from the payload (supports key rotation)
  const key = deriveKey(context, payload.v);

  const iv = Buffer.from(payload.iv, 'base64');
  const ciphertext = Buffer.from(payload.data, 'base64');
  const authTag = Buffer.from(payload.tag, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    // GCM authentication failed - data was tampered with or wrong key
    throw new Error('Decryption failed: data integrity check failed');
  }
}

/**
 * Decrypt and parse as JSON object
 *
 * @param encryptedBase64 - Base64 encoded encrypted payload
 * @param context - Field context for key derivation
 * @returns Parsed JSON object
 */
export function decryptJson<T = any>(encryptedBase64: string, context: FieldContext): T {
  const plaintext = decrypt(encryptedBase64, context);
  try {
    return JSON.parse(plaintext) as T;
  } catch {
    throw new Error('Decrypted value is not valid JSON');
  }
}

/**
 * Check if a value appears to be encrypted (for migration purposes)
 * Encrypted values are base64 JSON with specific structure
 */
export function isEncrypted(value: string): boolean {
  if (!value || value.length < 20) return false;

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'iv' in parsed &&
      'data' in parsed &&
      'tag' in parsed &&
      'v' in parsed
    );
  } catch {
    return false;
  }
}

/**
 * Hash a value for audit logging (one-way)
 * Used to track changes without storing actual values
 */
export function hashForAudit(value: string | object): string {
  const valueStr = typeof value === 'object' ? JSON.stringify(value) : value;
  return crypto.createHash('sha256').update(valueStr).digest('hex');
}

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Clear the derived key cache (call on key rotation)
 */
export function clearKeyCache(): void {
  derivedKeyCache.clear();
}

/**
 * Validate encryption key is configured (for health checks)
 */
export function validateEncryptionConfig(): { valid: boolean; error?: string } {
  try {
    getMasterKey();
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

export default {
  encrypt,
  decrypt,
  decryptJson,
  isEncrypted,
  hashForAudit,
  generateSecureToken,
  secureCompare,
  clearKeyCache,
  validateEncryptionConfig,
  FieldContext,
};
