import { createHmac, createSecretKey, KeyObject, timingSafeEqual } from 'crypto';
import {
  MENU_PUBLICATION_SLUG_MAX_LENGTH,
  MENU_PUBLICATION_SLUG_PATTERN,
} from '../publication-contract/menu-publication.contract';

const TOKEN_VERSION = 'v1';
const TABLE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export class TableQrTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableQrTokenError';
  }
}

export function normalizeTableQrIdentity(slug: string, tableId: string): {
  slug: string;
  tableId: string;
} {
  const normalizedSlug = slug.trim().toLowerCase();
  const normalizedTableId = tableId.trim();
  if (
    normalizedSlug.length > MENU_PUBLICATION_SLUG_MAX_LENGTH
    || !MENU_PUBLICATION_SLUG_PATTERN.test(normalizedSlug)
    || !TABLE_ID_PATTERN.test(normalizedTableId)
  ) {
    throw new TableQrTokenError('Masa QR kimligi gecersiz.');
  }
  return { slug: normalizedSlug, tableId: normalizedTableId };
}

function message(slug: string, tableId: string): string {
  return `${TOKEN_VERSION}\0${slug}\0${tableId}`;
}

export class TableQrTokenService {
  private readonly key: KeyObject;

  constructor(secret: Buffer) {
    if (secret.length < 32) {
      secret.fill(0);
      throw new TableQrTokenError('Masa QR imza anahtari en az 32 byte olmali.');
    }
    this.key = createSecretKey(secret);
    secret.fill(0);
  }

  sign(rawSlug: string, rawTableId: string): string {
    const { slug, tableId } = normalizeTableQrIdentity(rawSlug, rawTableId);
    const signature = createHmac('sha256', this.key)
      .update(message(slug, tableId), 'utf8')
      .digest('base64url');
    return `${TOKEN_VERSION}.${signature}`;
  }

  verify(token: string, rawSlug: string, rawTableId: string): boolean {
    if (!/^v1\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
    let expected: Buffer;
    let actual: Buffer;
    try {
      const { slug, tableId } = normalizeTableQrIdentity(rawSlug, rawTableId);
      expected = createHmac('sha256', this.key).update(message(slug, tableId), 'utf8').digest();
      const encoded = token.slice(TOKEN_VERSION.length + 1);
      actual = Buffer.from(encoded, 'base64url');
      if (actual.toString('base64url') !== encoded) return false;
    } catch {
      return false;
    }
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
