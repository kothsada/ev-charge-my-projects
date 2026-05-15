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
 * Returns the YYYY-MM-DD date string for Asia/Vientiane (UTC+7).
 * Use this instead of startOfDay(d)::date when writing to PostgreSQL DATE columns —
 * passing a string avoids the UTC-session ::date cast bug that shifts the date by one day
 * for events between Vientiane midnight (17:00 UTC) and UTC midnight.
 */
export const toVientianeDateStr = (d: Date): string => {
  const local = new Date(d.getTime() + TZ_OFFSET_MS);
  return local.toISOString().slice(0, 10);
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

/**
 * Parses a YYYY-MM-DD date string as a Vientiane (UTC+7) day boundary.
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param endOfDay - If true returns 23:59:59+07:00, otherwise 00:00:00+07:00
 */
export const parseVientianeDate = (dateStr: string, endOfDay = false): Date => {
  const timeStr = endOfDay ? 'T23:59:59+07:00' : 'T00:00:00+07:00';
  return new Date(`${dateStr}${timeStr}`);
};
