export type MenuDepartment =
  | 'KITCHEN'
  | 'BAR'
  | 'GRILL'
  | 'PASTRY'
  | 'COLD'
  | 'CASHIER'
  | 'PAKET'
  | 'POS';

/**
 * PRODUCTION departments that go to a physical kitchen station.
 * BAR (içecek) is intentionally excluded — beverages print nowhere.
 */
export const KITCHEN_STATION_DEPARTMENTS: ReadonlySet<MenuDepartment> = new Set([
  'KITCHEN',
  'COLD',
  'PASTRY',
]);

export const GRILL_STATION_DEPARTMENTS: ReadonlySet<MenuDepartment> = new Set([
  'GRILL',
]);

/** All departments that require a physical station print (not BAR/CASHIER/PAKET/POS). */
export const STATION_PRINT_DEPARTMENTS: ReadonlySet<MenuDepartment> = new Set([
  'KITCHEN',
  'COLD',
  'PASTRY',
  'GRILL',
]);

/**
 * Normalise a category name to plain ASCII-like lowercase for pattern matching.
 * Turkish characters are mapped BEFORE Unicode NFD decomposition so that
 * ı/İ/ğ/ş/ç/ö/ü all become their ASCII equivalents reliably.
 */
function normalizeCategoryName(value: string): string {
  return value
    .trim()
    // Map Turkish-specific characters that NFD cannot decompose
    .replace(/[İI]/g, 'i')
    .replace(/[ıI]/g, 'i')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Şş]/g, 's')
    .replace(/[Çç]/g, 'c')
    .replace(/[Öö]/g, 'o')
    .replace(/[Üü]/g, 'u')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip remaining diacritics
    .replace(/\s+/g, ' ');
}

/**
 * Resolve which preparation department an order-item belongs to.
 *
 * Rules (in priority order):
 *  1. If the stored department is anything other than KITCHEN (the Prisma
 *     default), it is authoritative — return it as-is.
 *  2. If the stored department IS KITCHEN (possibly a legacy default), inspect
 *     the category name for well-known keywords and override accordingly.
 *  3. Fall back to KITCHEN.
 *
 * BAR is returned for beverages so they can be excluded from station prints
 * while still appearing on the adisyon (bill).
 */
export function resolvePreparationDepartment(
  storedDepartment: string | null | undefined,
  categoryName?: string | null,
): MenuDepartment {
  const department = (storedDepartment || 'KITCHEN') as MenuDepartment;

  // Non-KITCHEN stored value is always authoritative
  if (department !== 'KITCHEN') return department;

  // No category name → cannot infer, stay KITCHEN
  if (!categoryName) return department;

  const cat = normalizeCategoryName(categoryName);

  // Izgara / Mangal / Ocakbaşı → GRILL
  if (/(izgara|mangal|ocakbasi|ocak)/.test(cat)) return 'GRILL';

  // İçecek / Meşrubat / Bar / Soğuk İçecek → BAR (not printed to any kitchen)
  if (/(icecek|mesrubat|\bbar\b|soguk|sicak icecek|cay|kahve|ayran|kola|su\b)/.test(cat)) return 'BAR';

  return department;
}
