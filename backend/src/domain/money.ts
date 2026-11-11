import { z } from "zod";

// Currencies a batch can be priced in. Every one supports PayPal Orders AUTHORIZE with a
// final partial capture. Amounts are always integer minor units of the batch currency:
// cents for USD, EUR, GBP, CAD and AUD, whole yen for JPY (PayPal rejects JPY decimals).
// One batch has exactly one currency; nothing is ever converted.
export const CURRENCY_EXPONENT = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
} as const;
export type Currency = keyof typeof CURRENCY_EXPONENT;
export const CURRENCIES = Object.keys(CURRENCY_EXPONENT) as Currency[];
export const currency = z.enum(CURRENCIES as [Currency, ...Currency[]]);

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && value in CURRENCY_EXPONENT;
}

// Value string PayPal expects, e.g. 4000 USD -> "40.00", 4000 JPY -> "4000".
export function paypalValue(minor: number, code: Currency = "USD") {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("invalid amount");
  const exp = CURRENCY_EXPONENT[code];
  if (exp === 0) return String(minor);
  return (minor / 10 ** exp).toFixed(exp);
}

// Human display for statements and PayPal notes, e.g. "$40.00", "€40.00", "¥4,000".
export function formatMoney(minor: number, code: Currency = "USD") {
  const exp = CURRENCY_EXPONENT[code];
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp);
}

// Exact match of a PayPal amount object against our minor units and currency.
export function sameMoney(
  amount: { currency_code?: unknown; value?: unknown } | undefined,
  minor: number,
  code: Currency = "USD",
) {
  return amount?.currency_code === code && amount.value === paypalValue(minor, code);
}
