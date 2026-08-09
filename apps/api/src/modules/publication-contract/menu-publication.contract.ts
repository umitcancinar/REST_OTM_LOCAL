import { createHash } from 'crypto';
import { z } from 'zod';

export const MENU_PUBLICATION_SCHEMA_VERSION = 1;
export const MENU_PUBLICATION_MAX_BYTES = 512 * 1024;
export const MENU_PUBLICATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MENU_PUBLICATION_SLUG_MAX_LENGTH = 128;

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable();
export function isSafePublicHostname(hostname: string): boolean {
  if (hostname.length > 253 || hostname.endsWith('.') || hostname.includes('..')) return false;
  const labels = hostname.toLowerCase().split('.');
  return labels.length >= 2 && labels.every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  ));
}

export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || !isSafePublicHostname(url.hostname)
    ) return false;
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(url.hostname);
    if (!ipv4) return true;
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false;
    return !(
      octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] === 0
    );
  } catch {
    return false;
  }
}

export function isSafeNavigationHref(value: string): boolean {
  return (
    /^\/(?![\\/])/.test(value)
    && !value.includes('\\')
    && !/%(?:2f|5c)/i.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value)
  ) || isSafePublicHttpsUrl(value);
}

const httpsUrl = z.string().max(2048).url().refine(isSafePublicHttpsUrl, {
  message: 'Only HTTPS public assets are allowed',
});
const nullableHttpsUrl = httpsUrl.nullable();
const publicId = z.string().regex(/^[a-f0-9]{32}$/);
const slug = z.string()
  .regex(MENU_PUBLICATION_SLUG_PATTERN)
  .max(MENU_PUBLICATION_SLUG_MAX_LENGTH);
const publicHostname = z.string().max(253).refine(isSafePublicHostname);
const color = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const fontFamily = z.string().regex(/^[A-Za-z0-9 ,_'"-]{1,80}$/);

const navLinkSchema = z.object({
  label: text(80),
  href: z.string().max(512).refine(isSafeNavigationHref),
}).strict();

export const publicSettingsSchema = z.object({
  theme: z.object({
    primaryColor: color.optional(),
    secondaryColor: color.optional(),
    backgroundColor: color.optional(),
    fontFamily: fontFamily.optional(),
  }).strict().optional(),
  workingHours: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), text(80))
    .refine((value) => Object.keys(value).length <= 14, 'Too many working-hour entries')
    .optional(),
  navLinks: z.array(navLinkSchema).max(30).optional(),
  socialLinks: z.array(z.object({ label: text(80), url: httpsUrl }).strict()).max(20).optional(),
  about: text(4000).optional(),
  hero: z.object({
    title: text(160).optional(),
    subtitle: text(500).optional(),
    imageUrl: httpsUrl.optional(),
  }).strict().optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).optional(),
}).strict();

const portionSchema = z.object({
  id: publicId.optional(),
  name: text(80),
  multiplier: z.number().finite().min(0.01).max(100),
  priceOverride: z.number().finite().min(0).max(10_000_000).optional(),
}).strict();

const extraSchema = z.object({
  id: publicId.optional(),
  name: text(100),
  price: z.number().finite().min(0).max(10_000_000),
}).strict();

const itemSchema = z.object({
  id: publicId,
  name: text(200),
  description: nullableText(4000),
  image: nullableHttpsUrl,
  basePrice: z.number().finite().min(0).max(10_000_000),
  portionOptions: z.array(portionSchema).max(50),
  extras: z.array(extraSchema).max(100),
  calories: z.number().int().min(0).max(100_000).nullable(),
  allergens: z.array(text(100)).max(100),
  extraInfo: nullableText(4000),
  badge: nullableText(80),
  sortOrder: z.number().int().min(-100_000).max(100_000),
  isActive: z.literal(true),
}).strict();

const categorySchema = z.object({
  id: publicId,
  name: text(160),
  description: nullableText(2000),
  image: nullableHttpsUrl,
  sortOrder: z.number().int().min(-100_000).max(100_000),
  isActive: z.literal(true),
  items: z.array(itemSchema).max(2_000),
}).strict();

const tenantInfoSchema = z.object({
  id: publicId,
  name: text(160),
  slug,
  customDomain: publicHostname.nullable(),
  logo: nullableHttpsUrl,
  settings: publicSettingsSchema,
  address: nullableText(500),
  phone: nullableText(50),
  email: z.string().email().max(254).nullable(),
}).strict();

const gallerySchema = z.object({
  id: publicId,
  url: httpsUrl,
  caption: nullableText(500),
  sortOrder: z.number().int().min(-100_000).max(100_000),
  isActive: z.literal(true),
}).strict();

const storySchema = z.object({
  id: publicId,
  title: nullableText(200),
  mediaUrl: httpsUrl,
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  duration: z.number().int().min(100).max(120_000),
  sortOrder: z.number().int().min(-100_000).max(100_000),
  isActive: z.literal(true),
  expiresAt: z.string().datetime().nullable(),
}).strict();

const reviewSchema = z.object({
  id: publicId,
  customerName: text(160),
  rating: z.number().int().min(1).max(5),
  text: text(4000),
  source: text(80),
  isApproved: z.literal(true),
}).strict();

export const menuPublicationPayloadSchema = z.object({
  schemaVersion: z.literal(MENU_PUBLICATION_SCHEMA_VERSION),
  tenant: tenantInfoSchema,
  menu: z.object({
    restaurantName: text(160),
    categories: z.array(categorySchema).max(500),
  }).strict(),
  cms: z.object({
    settings: publicSettingsSchema,
    gallery: z.array(gallerySchema).max(500),
    stories: z.array(storySchema).max(500),
    reviews: z.array(reviewSchema).max(2_000),
    navLinks: z.array(navLinkSchema).max(30),
  }).strict(),
}).strict();

export const menuPublicationPushSchema = z.object({
  version: z.number().int().positive().max(2_147_483_647),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  payload: menuPublicationPayloadSchema,
}).strict();

export type MenuPublicationPayload = z.infer<typeof menuPublicationPayloadSchema>;
export type MenuPublicationPush = z.infer<typeof menuPublicationPushSchema>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

export function publicationChecksum(payload: MenuPublicationPayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}
