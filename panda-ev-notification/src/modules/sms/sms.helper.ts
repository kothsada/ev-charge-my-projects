/**
 * SMS helper: phone number parsing and operator/network detection.
 *
 * Laos mobile number breakdown example:
 *   Full: 8562078559999
 *   856  = country code (Laos)
 *   2078559999 = local mobile number
 *   207  = operator prefix (first 3 digits of local number)
 *
 * Operator → network type mapping:
 *   Onnet  = LTC (Laotel) numbers → 200 LAK/SMS
 *   Offnet = all other carriers   → 300 LAK/SMS
 *
 * Configure onnet prefixes via env var LTC_ONNET_OPERATOR_PREFIXES (comma-separated).
 * Default prefixes below are illustrative — verify with LTC numbering plan.
 */

export const ONNET_PRICE_LAK = 200;
export const OFFNET_PRICE_LAK = 300;

// LTC (Laotel) operator prefix — onnet numbers start with 205.
// Update via LTC_ONNET_OPERATOR_PREFIXES env var if LTC adds new number ranges.
const DEFAULT_ONNET_PREFIXES = ['205'];

function getOnnetPrefixes(): Set<string> {
  const fromEnv = process.env.LTC_ONNET_OPERATOR_PREFIXES;
  const raw = fromEnv ?? DEFAULT_ONNET_PREFIXES.join(',');
  return new Set(
    raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  );
}

export interface ParsedPhone {
  countryCode: string;
  mobileNumber: string;
  operator: string;
  fullPhoneNumber: string;
  networkType: 'ONNET' | 'OFFNET';
  costLak: number;
}

/**
 * Parse a phone number string into its constituent parts.
 *
 * Supports:
 *  - Full E.164-style without + : "8562078559999"
 *  - Local Laos format           : "2078559999"   (856 prepended)
 *
 * Strips spaces, dashes, and leading +.
 */
export function parsePhoneNumber(phone: string): ParsedPhone {
  const digits = phone.replace(/[\s\-+]/g, '');

  let countryCode: string;
  let mobileNumber: string;

  if (digits.startsWith('856')) {
    countryCode = '856';
    mobileNumber = digits.slice(3);
  } else if (digits.startsWith('66')) {
    countryCode = '66';
    mobileNumber = digits.slice(2);
  } else {
    // Assume Laos local format
    countryCode = '856';
    mobileNumber = digits;
  }

  const operator = mobileNumber.slice(0, 3);
  const fullPhoneNumber = countryCode + mobileNumber;

  const networkType = getOnnetPrefixes().has(operator) ? 'ONNET' : 'OFFNET';
  const costLak = networkType === 'ONNET' ? ONNET_PRICE_LAK : OFFNET_PRICE_LAK;

  return { countryCode, mobileNumber, operator, fullPhoneNumber, networkType, costLak };
}

// Monotonic sequence counter for transaction ID uniqueness within the same second
let txSeq = 0;

/**
 * Generate a unique LTC transaction ID.
 * Format: {PARTNER_ID}{YYYYMMDD}{HHmmss}{seq:06}
 * Total length ≤ 30 chars for a 3-char partner ID.
 */
export function generateTransactionId(): string {
  const partnerId = (process.env.LTC_SMS_PARTNER_ID ?? 'PEV').slice(0, 6);
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const date = `${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  txSeq = (txSeq + 1) % 999999;
  return `${partnerId}${date}${time}${pad(txSeq, 6)}`;
}
