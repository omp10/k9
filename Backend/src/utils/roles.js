/**
 * Admin accounts are issued with several role spellings depending on how they were created:
 * ADMIN, SUPER_ADMIN, SUPER-ADMIN, SUPERADMIN, PLATFORM_SUPERADMIN. They all mean "admin".
 *
 * Each guard used to hardcode one spelling, so a valid super-admin was rejected by whichever
 * guard disagreed — 403s across the food and taxi admin panels. Normalise in one place.
 */
const SUPER_ADMIN_PATTERN = /^(super[-_ ]?admin|platform[-_ ]?superadmin|superadmin)$/i;

/** True when the role means administrator, whatever its spelling. */
export const isAdminRole = (role) => {
  const value = String(role || '').trim();
  return value.toUpperCase() === 'ADMIN' || SUPER_ADMIN_PATTERN.test(value);
};

/** Canonical uppercase role, collapsing every admin spelling to ADMIN. */
export const canonicalRole = (role) => {
  const value = String(role || '').trim();
  return isAdminRole(value) ? 'ADMIN' : value.toUpperCase();
};
