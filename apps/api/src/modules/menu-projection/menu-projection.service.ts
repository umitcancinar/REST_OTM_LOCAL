import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  MENU_PUBLICATION_SCHEMA_VERSION,
  isSafeNavigationHref,
  isSafePublicHostname,
  isSafePublicHttpsUrl,
  type MenuPublicationPayload,
  menuPublicationPayloadSchema,
  publicationChecksum,
} from '../publication-contract/menu-publication.contract';
import { registerTenantPublicProjectionHook } from '../publication-contract/menu-projection.hook';

type DbClient = Prisma.TransactionClient;

let kickRuntime: (() => void) | undefined;

export function registerMenuProjectionKick(kick: (() => void) | undefined): void {
  kickRuntime = kick;
}

export function kickMenuProjectionOutbox(): void {
  kickRuntime?.();
}

function publicId(tenantId: string, kind: string, sourceId: string): string {
  return createHash('sha256')
    .update(`rest-otm-public-v1\0${tenantId}\0${kind}\0${sourceId}`)
    .digest('hex')
    .slice(0, 32);
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return readObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clipped(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, max) : undefined;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    return isSafePublicHttpsUrl(parsed.toString()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function publicSettings(value: unknown) {
  const source = readObject(value);
  const result: Record<string, unknown> = {};
  const theme = readObject(source.theme);
  const projectedTheme: Record<string, string> = {};
  const fontFamily = clipped(theme.fontFamily, 80);
  if (fontFamily && /^[A-Za-z0-9 ,_'"-]{1,80}$/.test(fontFamily)) {
    projectedTheme.fontFamily = fontFamily;
  }
  for (const key of ['primaryColor', 'secondaryColor', 'backgroundColor']) {
    const value = clipped(theme[key], 9);
    if (value && /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value)) {
      projectedTheme[key] = value;
    }
  }
  if (Object.keys(projectedTheme).length) result.theme = projectedTheme;

  const hours = readObject(source.workingHours);
  const projectedHours = Object.fromEntries(Object.entries(hours).slice(0, 14).flatMap(([key, val]) => {
    const safe = clipped(val, 80);
    return safe === undefined || !/^[A-Za-z0-9_-]{1,32}$/.test(key) ? [] : [[key, safe]];
  }));
  if (Object.keys(projectedHours).length) result.workingHours = projectedHours;

  const navLinks = Array.isArray(source.navLinks) ? source.navLinks : [];
  result.navLinks = navLinks.slice(0, 30).flatMap((entry) => {
    const row = readObject(entry);
    const label = clipped(row.label, 80);
    const href = clipped(row.href, 512);
    return label && href && isSafeNavigationHref(href)
      ? [{ label, href }]
      : [];
  });
  const socialLinks = Array.isArray(source.socialLinks) ? source.socialLinks : [];
  result.socialLinks = socialLinks.slice(0, 20).flatMap((entry) => {
    const row = readObject(entry);
    const label = clipped(row.label, 80);
    const url = httpsUrl(row.url);
    return label && url ? [{ label, url }] : [];
  });
  const about = clipped(source.about, 4000);
  if (about) result.about = about;
  const hero = readObject(source.hero);
  const projectedHero = {
    ...(clipped(hero.title, 160) && { title: clipped(hero.title, 160) }),
    ...(clipped(hero.subtitle, 500) && { subtitle: clipped(hero.subtitle, 500) }),
    ...(httpsUrl(hero.imageUrl) && { imageUrl: httpsUrl(hero.imageUrl) }),
  };
  if (Object.keys(projectedHero).length) result.hero = projectedHero;
  if (['TRY', 'USD', 'EUR'].includes(String(source.currency))) result.currency = source.currency;
  return result;
}

function publicOptions(tenantId: string, kind: string, value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const result: Array<Record<string, unknown>> = [];
  value.slice(0, kind === 'portion' ? 50 : 100).forEach((entry, index) => {
    const row = readObject(entry);
    const name = clipped(row.name, kind === 'portion' ? 80 : 100);
    if (!name) return;
    if (kind === 'portion') {
      const multiplier = Number(row.multiplier);
      if (!Number.isFinite(multiplier) || multiplier < 0.01 || multiplier > 100) return;
      const priceOverride = Number(row.priceOverride);
      result.push({
        id: publicId(tenantId, 'portion', String(row.id || `${index}:${name}`)),
        name,
        multiplier,
        ...(Number.isFinite(priceOverride) && priceOverride >= 0 && { priceOverride }),
      });
      return;
    }
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return;
    result.push({
      id: publicId(tenantId, 'extra', String(row.id || `${index}:${name}`)),
      name,
      price,
    });
  });
  return result;
}

function publicAllergens(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => clipped(entry, 100) || []).slice(0, 100)
    : [];
}

export async function buildMenuPublication(
  tx: DbClient,
  tenantId: string,
): Promise<MenuPublicationPayload> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      customDomain: true,
      logo: true,
      address: true,
      phone: true,
      email: true,
      settings: true,
      menuCategories: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { items: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      },
      galleryImages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      stories: {
        where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { sortOrder: 'asc' },
      },
      reviews: { where: { isApproved: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!tenant) throw Object.assign(new Error('Projection tenant bulunamadı'), { statusCode: 404 });
  const settings = publicSettings(tenant.settings);
  const categories = tenant.menuCategories.map((category) => ({
    id: publicId(tenantId, 'category', category.id),
    name: category.name.slice(0, 160),
    description: category.description?.slice(0, 2000) || null,
    image: httpsUrl(category.image),
    sortOrder: category.sortOrder,
    isActive: true as const,
    items: category.items.map((item) => ({
      id: publicId(tenantId, 'item', item.id),
      name: item.name.slice(0, 200),
      description: item.description?.slice(0, 4000) || null,
      image: httpsUrl(item.image),
      basePrice: item.basePrice,
      portionOptions: publicOptions(tenantId, 'portion', item.portionOptions),
      extras: publicOptions(tenantId, 'extra', item.extras),
      calories: item.calories,
      allergens: publicAllergens(item.allergens),
      extraInfo: item.extraInfo?.slice(0, 4000) || null,
      badge: item.badge?.slice(0, 80) || null,
      sortOrder: item.sortOrder,
      isActive: true as const,
    })),
  }));
  const payload = {
    schemaVersion: MENU_PUBLICATION_SCHEMA_VERSION as 1,
    tenant: {
      id: publicId(tenantId, 'tenant', tenant.id),
      name: tenant.name.slice(0, 160),
      slug: tenant.slug.toLowerCase(),
      customDomain: tenant.customDomain && isSafePublicHostname(tenant.customDomain.toLowerCase())
        ? tenant.customDomain.toLowerCase()
        : null,
      logo: httpsUrl(tenant.logo),
      settings,
      address: tenant.address?.slice(0, 500) || null,
      phone: tenant.phone?.slice(0, 50) || null,
      email: tenant.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(tenant.email)
        ? tenant.email.slice(0, 254)
        : null,
    },
    menu: { restaurantName: tenant.name.slice(0, 160), categories },
    cms: {
      settings,
      gallery: tenant.galleryImages.flatMap((image) => {
        const url = httpsUrl(image.url);
        return url ? [{
          id: publicId(tenantId, 'gallery', image.id),
          url,
          caption: image.caption?.slice(0, 500) || null,
          sortOrder: image.sortOrder,
          isActive: true as const,
        }] : [];
      }),
      stories: tenant.stories.flatMap((story) => {
        const mediaUrl = httpsUrl(story.mediaUrl);
        return mediaUrl ? [{
          id: publicId(tenantId, 'story', story.id),
          title: story.title?.slice(0, 200) || null,
          mediaUrl,
          mediaType: story.mediaType,
          duration: Math.min(120_000, Math.max(100, story.duration)),
          sortOrder: story.sortOrder,
          isActive: true as const,
          expiresAt: story.expiresAt?.toISOString() || null,
        }] : [];
      }),
      reviews: tenant.reviews.map((review) => ({
        id: publicId(tenantId, 'review', review.id),
        customerName: review.customerName.slice(0, 160),
        rating: Math.min(5, Math.max(1, review.rating)),
        text: review.text.slice(0, 4000),
        source: review.source.slice(0, 80),
        isApproved: true as const,
      })),
      navLinks: Array.isArray(settings.navLinks) ? settings.navLinks : [],
    },
  };
  return menuPublicationPayloadSchema.parse(payload);
}

/** Called inside the same transaction as each public-content mutation. */
export async function enqueueMenuProjection(tx: DbClient, tenantId: string) {
  const payload = await buildMenuPublication(tx, tenantId);
  const checksum = publicationChecksum(payload);
  const rows = await tx.$queryRaw<Array<{ version: number }>>(Prisma.sql`
    INSERT INTO "menu_projection_sequences" ("tenantId", "version", "updatedAt")
    VALUES (${tenantId}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("tenantId") DO UPDATE
      SET "version" = "menu_projection_sequences"."version" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "version"
  `);
  const version = rows[0]?.version;
  if (!version) throw new Error('Projection version ayrılamadı');
  return tx.menuProjectionOutbox.create({
    data: {
      tenantId,
      version,
      checksum,
      payload: payload as unknown as Prisma.InputJsonObject,
    },
  });
}

// Registration is a local-profile side effect because only the local runtime
// imports this module. Cloud tenant administration sees a no-op neutral hook.
registerTenantPublicProjectionHook(enqueueMenuProjection);
