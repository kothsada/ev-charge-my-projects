const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 (Asia/Vientiane)

/** ISO string in Vientiane local time */
export const nowBangkokIso = (): string => {
  const local = new Date(Date.now() + TZ_OFFSET_MS);
  return local.toISOString().replace('Z', '+07:00');
};

/** ISO string of a Date in Vientiane local time */
export const toBangkokIso = (d: Date): string => {
  const local = new Date(d.getTime() + TZ_OFFSET_MS);
  return local.toISOString().replace('Z', '+07:00');
};

/**
 * Returns a UTC Date representing the start of the local (UTC+7) hour
 * that contains `d`. Used for hourly stats bucket keys.
 */
export const startOfHour = (d: Date): Date => {
  const localMs = d.getTime() + TZ_OFFSET_MS;
  const truncated = Math.floor(localMs / (3_600_000)) * 3_600_000;
  return new Date(truncated - TZ_OFFSET_MS);
};

/**
 * Returns a UTC Date representing midnight of the local (UTC+7) day
 * that contains `d`. Used for daily stats bucket keys.
 */
export const startOfDay = (d: Date): Date => {
  const localMs = d.getTime() + TZ_OFFSET_MS;
  const truncated = Math.floor(localMs / (86_400_000)) * 86_400_000;
  return new Date(truncated - TZ_OFFSET_MS);
};
