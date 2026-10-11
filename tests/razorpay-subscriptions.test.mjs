import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifySubscriptionPaymentSignature,
  verifyRazorpayWebhookSignature,
  razorpayUserStatus,
  razorpayWorkspaceStatus,
  razorpayEpochToIso,
} from "../src/lib/razorpay-subscription-utils.mjs";

test("subscription checkout signature uses payment ID then server-held subscription ID", () => {
  const secret = "test-secret-never-used-in-production";
  const subscriptionId = "sub_test_123";
  const paymentId = "pay_test_456";
  const signature = createHmac("sha256", secret)
    .update(paymentId + "|" + subscriptionId)
    .digest("hex");

  assert.equal(verifySubscriptionPaymentSignature(subscriptionId, paymentId, signature, secret), true);
  assert.equal(verifySubscriptionPaymentSignature(subscriptionId, paymentId, signature, "wrong-secret"), false);
  assert.equal(verifySubscriptionPaymentSignature(subscriptionId, "pay_other", signature, secret), false);
  assert.equal(verifySubscriptionPaymentSignature("sub_other", paymentId, signature, secret), false);
  assert.equal(verifySubscriptionPaymentSignature(subscriptionId, paymentId, "not-a-signature", secret), false);
  assert.equal(verifySubscriptionPaymentSignature("", paymentId, signature, secret), false);
});

test("webhook signature is calculated over the exact raw request body", () => {
  const secret = "webhook-test-secret";
  const raw = '{"event":"subscription.charged","created_at":1791741600}';
  const signature = createHmac("sha256", secret).update(raw).digest("hex");

  assert.equal(verifyRazorpayWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyRazorpayWebhookSignature(raw + " ", signature, secret), false);
  assert.equal(verifyRazorpayWebhookSignature(raw, signature, ""), false);
});

test("Razorpay user states never grant entitlement for a pending or halted subscription", () => {
  assert.equal(razorpayUserStatus("active"), "active");
  assert.equal(razorpayUserStatus("resumed"), "active");
  assert.equal(razorpayUserStatus("created"), "pending");
  assert.equal(razorpayUserStatus("authenticated"), "pending");
  assert.equal(razorpayUserStatus("pending"), "past_due");
  assert.equal(razorpayUserStatus("halted"), "past_due");
  assert.equal(razorpayUserStatus("paused"), "past_due");
  assert.equal(razorpayUserStatus("cancelled"), "cancelled");
  assert.equal(razorpayUserStatus("completed"), "cancelled");
  assert.equal(razorpayUserStatus("expired"), "cancelled");
});

test("workspace states use only statuses allowed by the workspace subscription schema", () => {
  assert.equal(razorpayWorkspaceStatus("active"), "active");
  assert.equal(razorpayWorkspaceStatus("resumed"), "active");
  assert.equal(razorpayWorkspaceStatus("created"), "pending");
  assert.equal(razorpayWorkspaceStatus("halted"), "pending");
  assert.equal(razorpayWorkspaceStatus("cancelled"), "cancelled");
  assert.equal(razorpayWorkspaceStatus("completed"), "cancelled");
});

test("Razorpay epoch fields are seconds, and invalid values do not become dates", () => {
  assert.equal(razorpayEpochToIso(1791741600), "2026-10-11T18:00:00.000Z");
  assert.equal(razorpayEpochToIso(null), null);
  assert.equal(razorpayEpochToIso(Number.NaN), null);
});

test("recurring Plan validation fails closed on mismatched or missing billing fields", async () => {
  const { razorpayPlanMatchesCatalog } = await import("../src/lib/razorpay-subscription-utils.mjs");
  const expected = { id: "plan_pro", pricePaise: 49900 };
  const valid = {
    id: "plan_pro",
    period: "monthly",
    interval: 1,
    item: { amount: 49900, currency: "INR", active: true },
  };

  assert.equal(razorpayPlanMatchesCatalog(valid, expected), true);
  assert.equal(razorpayPlanMatchesCatalog({ ...valid, id: "plan_other" }, expected), false);
  assert.equal(razorpayPlanMatchesCatalog({ ...valid, period: "yearly" }, expected), false);
  assert.equal(razorpayPlanMatchesCatalog({ ...valid, interval: 12 }, expected), false);
  assert.equal(razorpayPlanMatchesCatalog({ ...valid, item: { ...valid.item, amount: 149900 } }, expected), false);
  assert.equal(razorpayPlanMatchesCatalog({ ...valid, item: { amount: 49900 } }, expected), false);
  assert.equal(razorpayPlanMatchesCatalog({ ...valid, item: { ...valid.item, currency: "USD" } }, expected), false);
  assert.equal(razorpayPlanMatchesCatalog({ ...valid, item: { ...valid.item, active: false } }, expected), false);
  assert.equal(razorpayPlanMatchesCatalog(null, expected), false);
});

test("scheduled subscription starts use Unix seconds and do not activate early", async () => {
  const { razorpaySubscriptionStartIsFuture } = await import("../src/lib/razorpay-subscription-utils.mjs");
  const now = 1_800_000_000;

  assert.equal(razorpaySubscriptionStartIsFuture(now + 3600, null, now), true);
  assert.equal(razorpaySubscriptionStartIsFuture(null, now + 3600, now), true);
  assert.equal(razorpaySubscriptionStartIsFuture(now + 30, null, now), false);
  assert.equal(razorpaySubscriptionStartIsFuture(now - 3600, null, now), false);
  assert.equal(razorpaySubscriptionStartIsFuture(undefined, undefined, now), false);
});
