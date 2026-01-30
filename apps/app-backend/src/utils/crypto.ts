/**
 * Encryption utilities for sensitive data storage
 *
 * Uses AES-256-GCM for authenticated encryption of API keys and other secrets.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Get the master encryption key from environment
 * Falls back to a default key for development only
 */
function getMasterKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    // If it looks like base64, decode it
    if (/^[A-Za-z0-9+/]+=*$/.test(envKey) && envKey.length >= 32) {
      try {
        const decoded = Buffer.from(envKey, "base64");
        if (decoded.length >= KEY_LENGTH) {
          return decoded.subarray(0, KEY_LENGTH);
        }
      } catch {
        // Not valid base64, use as passphrase
      }
    }
    // Use scrypt to derive a key from the passphrase
    return scryptSync(envKey, "zeus-salt", KEY_LENGTH);
  }

  // Default development key - DO NOT use in production
  console.warn(
    "WARNING: Using default encryption key. Set ENCRYPTION_KEY environment variable for production.",
  );
  return scryptSync("zeus-development-key", "zeus-salt", KEY_LENGTH);
}

/**
 * Encrypt a plaintext string
 * @returns Object with cipher text and IV (both base64 encoded)
 */
export function encrypt(plaintext: string): { cipher: string; iv: string } {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  // Append auth tag to cipher text
  const authTag = cipher.getAuthTag();
  const cipherWithTag = Buffer.concat([Buffer.from(encrypted, "base64"), authTag]);

  return {
    cipher: cipherWithTag.toString("base64"),
    iv: iv.toString("base64"),
  };
}

/**
 * Decrypt a cipher text
 * @param cipher Base64 encoded cipher text (includes auth tag)
 * @param iv Base64 encoded initialization vector
 * @returns Decrypted plaintext string
 */
export function decrypt(cipher: string, iv: string): string {
  const key = getMasterKey();
  const ivBuffer = Buffer.from(iv, "base64");
  const cipherBuffer = Buffer.from(cipher, "base64");

  // Extract auth tag from the end of cipher text
  const authTag = cipherBuffer.subarray(cipherBuffer.length - AUTH_TAG_LENGTH);
  const encryptedData = cipherBuffer.subarray(0, cipherBuffer.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, ivBuffer, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Mask an API key for display (show only first 4 and last 4 characters)
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) {
    return "****";
  }
  const prefix = apiKey.substring(0, 4);
  const suffix = apiKey.substring(apiKey.length - 4);
  return `${prefix}...${suffix}`;
}

/**
 * Check if a string looks like a masked API key
 */
export function isMaskedKey(value: string): boolean {
  return /^.{4}\.\.\..{4}$/.test(value) || value === "****";
}
