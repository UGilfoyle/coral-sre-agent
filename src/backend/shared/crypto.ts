import crypto from 'crypto';

// Retrieve or derive the 32-byte encryption key
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'coral-ai-bot-encryption-secret-default-key-safe-32';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard IV length is 12 bytes
const SALT = 'coral-salt-sre-saas-platform-static';

// Dynamically derive a cryptographically safe 32-byte key from the secret
const key = crypto.scryptSync(ENCRYPTION_SECRET, SALT, 32);

/**
 * Encrypts a plain-text token using AES-256-GCM.
 * Returns the format: iv.encryptedText.authTag (all hex-encoded)
 */
export function encryptToken(text: string): string {
  if (!text) return '';
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}.${encrypted}.${authTag}`;
}

/**
 * Decrypts an AES-256-GCM encrypted token string.
 * Expects the format: iv.encryptedText.authTag
 */
export function decryptToken(encryptedData: string): string {
  if (!encryptedData) return '';
  
  try {
    const parts = encryptedData.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format. Expected 3 components.');
    }
    
    const [ivHex, encryptedHex, authTagHex] = parts;
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch {
    throw new Error(`Failed to decrypt credentials. System configuration or secret might have changed.`);
  }
}
