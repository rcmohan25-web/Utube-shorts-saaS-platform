import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM, per §9.1 — YouTube OAuth tokens are encrypted before DB storage
// and only decrypted in-memory when calling the YouTube API.
//
// The key is read lazily (not in a constructor/onModuleInit) so the rest of
// the app keeps working even if ENCRYPTION_KEY isn't set yet in dev — you
// only hit the error the moment something actually tries to encrypt/decrypt
// a token, with a message telling you how to fix it.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended IV length for GCM

@Injectable()
export class EncryptionService {
  private key: Buffer | null = null;

  private getKey(): Buffer {
    if (this.key) return this.key;

    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error(
        'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
          'Generate one with `openssl rand -hex 32` and set it in apps/api/.env.',
      );
    }

    this.key = Buffer.from(hex, 'hex');
    return this.key;
  }

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // iv:authTag:ciphertext, each base64 — self-contained so decrypt() needs
    // nothing but the stored string and the key.
    return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const key = this.getKey();
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed encrypted payload');
    }

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);

    return plaintext.toString('utf8');
  }
}
