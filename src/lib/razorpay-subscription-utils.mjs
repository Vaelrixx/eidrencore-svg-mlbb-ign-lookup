import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Razorpay Standard Checkout's subscription signature.
 * Razorpay documents the signed message as payment_id + "|" + subscription_id.
 */
export function verifySubscriptionPaymentSignature(subscriptionId, paymentId, signature, secret) {
  if (
    typeof subscriptionId !== "string" ||
    !subscriptionId ||
    typeof paymentId !== "string" ||
    !paymentId ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature) ||
    typeof secret !== "string" ||
    !secret
  ) return false;

  const expected = createHmac("sha256", secret)
    .update(paymentId + "|" + subscriptionId, "utf8")
    .digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyRazorpayWebhookSignature(rawBody, signature, secret) {
  if (
    typeof rawBody !== "string" ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature) ||
    typeof secret !== "string" ||
    !secret
  ) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function razorpayUserStatus(status) {
  switch (status) {
    case "active":
    case "resumed":
      return "active";
    case "cancelled":
    case "completed":
    case "expired":
      return "cancelled";
    case "created":
    case "authenticated":
      return "pending";
    case "pending":
    case "halted":
    case "paused":
    default:
      return "past_due";
  }
}

export function razorpayWorkspaceStatus(status) {
  switch (status) {
    case "active":
    case "resumed":
      return "active";
    case "cancelled":
    case "completed":
    case "expired":
      return "cancelled";
    case "created":
    case "authenticated":
    case "pending":
    case "halted":
    case "paused":
    default:
      return "pending";
  }
}

/** Razorpay Subscription date fields are Unix timestamps in seconds. */
export function razorpayEpochToIso(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Rejects provider Plans whose identity, cadence, currency or amount cannot
 * be proven to match the locally published paid-plan catalog.
 */
export function razorpayPlanMatchesCatalog(plan, expected) {
  return Boolean(
    plan &&
    expected &&
    typeof plan.id === "string" &&
    plan.id === expected.id &&
    plan.period === "monthly" &&
    plan.interval === 1 &&
    plan.item?.active !== false &&
    Number(plan.item?.amount) === expected.pricePaise &&
    typeof plan.item?.currency === "string" &&
    plan.item.currency.toUpperCase() === "INR"
  );
}

/** Detects a scheduled start using Razorpay's Unix-seconds fields and a small clock-skew allowance. */
export function razorpaySubscriptionStartIsFuture(startAt, currentStart, nowSeconds = Math.floor(Date.now() / 1000), clockSkewSeconds = 60) {
  const candidate = Number(startAt || currentStart || 0);
  return Number.isFinite(candidate) && candidate > nowSeconds + clockSkewSeconds;
}
