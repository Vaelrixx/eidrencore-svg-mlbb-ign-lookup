# Razorpay recurring subscriptions

Eidren supports recurring Pro and Business plans through Razorpay Subscriptions. The existing one-time Orders checkout remains supported for checkouts already in progress; newly initiated paid checkouts use a subscription only after the recurring setup is complete.

## What is required before enabling it

Recurring checkout fails closed unless all of the following are true:

- The server has RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET for the same Razorpay mode (Test or Live).
- RAZORPAY_PRO_PLAN_ID and RAZORPAY_BUSINESS_PLAN_ID point to Razorpay Plans created in that same mode.
- Each provider Plan is active, monthly with interval 1, denominated in INR, and its amount exactly matches the corresponding enabled row in public.developer_plans.
- The database migration 20261012100000_razorpay_recurring_billing.sql has been applied after the repository's previous migration-version alignment has been resolved and reviewed.
- RAZORPAY_WEBHOOK_SECRET is set to the signing secret configured for the appropriate Test or Live webhook.

Plan IDs are separate from the prices stored in Eidren. The application deliberately does not create or modify Plans automatically, and does not accept recurring payments if the IDs, amount, currency, or monthly cadence do not match.

## Razorpay dashboard configuration

1. In Razorpay Test Mode, create a monthly INR Plan for each paid tier using the current amounts from the Eidren plan catalog. Copy the resulting Plan IDs into the staging environment's RAZORPAY_PRO_PLAN_ID and RAZORPAY_BUSINESS_PLAN_ID. Do not put Test Mode keys on the current production deployment.
2. Configure the staging backend's Razorpay Test Mode key ID, key secret, and webhook secret. Keep all values in server-side Railway environment variables; never add them to source code or NEXT_PUBLIC_* variables.
3. Add a Razorpay Test Mode webhook for the staging URL:

   https://<staging-host>/api/billing/webhook

   Select the following events:
   - subscription.authenticated
   - subscription.activated
   - subscription.charged
   - subscription.updated
   - subscription.pending
   - subscription.halted
   - subscription.cancelled
   - subscription.completed
   - subscription.paused
   - subscription.resumed
   - payment.captured and order.paid while legacy one-time Orders remain supported.

4. Store the webhook signing secret in the staging RAZORPAY_WEBHOOK_SECRET variable. It is independent of the API key secret.
5. Deploy to staging only after the migration is reviewed/applied there. Confirm GET /api/billing/plans reports recurringConfigured: true. This checks for configured IDs and credentials; a paid checkout additionally fetches each Plan and verifies the provider amount/currency/cadence before it creates a Subscription.

Razorpay references: [Subscriptions API and checkout/signature flow](https://d6xcmfyh68wv8.cloudfront.net/docs/api/payments/subscriptions/), [subscription lifecycle events](https://d6xcmfyh68wv8.cloudfront.net/docs/payments/subscriptions/notifications/), and [webhook signature validation](https://d6xcmfyh68wv8.cloudfront.net/docs/x/webhooks/).

## Checkout, renewal, and access semantics

- Checkout creates a Razorpay Subscription with a 1200-cycle maximum and sends the user to Razorpay's authorization flow. Authorization alone is not treated as an active paid subscription: the provider must report the Subscription active, and the server must validate it.
- The signature uses razorpay_payment_id + "|" + subscription_id. Eidren retrieves the expected subscription ID from its server-side database; it does not trust the ID returned by the browser alone.
- Account and workspace subscriptions have separate provider IDs and metadata. Workspace checkout/cancellation requires an owner or admin. Paid workspace API keys follow the workspace entitlement.
- subscription.charged updates the paid period. subscription.pending / subscription.halted do not erase access already paid for; the previously paid tier remains until its current period ends. When that period expires with no successful renewal, API keys fall back to Free quota.
- Canceling a recurring plan schedules cancellation at the end of the paid period when possible. It is not a refund. A scheduled plan change is cleared before a cancellation is scheduled so a customer isn't surprised by a tier change at renewal.
- Changing Pro ↔ Business uses Razorpay's cycle-end schedule. The existing plan remains in effect until Razorpay applies the change and sends a lifecycle event.
- Existing one-time Orders remain verifiable by the legacy order signature and captured-payment check. Existing one-time purchases are not silently converted to recurring charges. A customer with a paid legacy term can explicitly opt into auto-renewal, scheduled to start at that term's end.

## Test-mode release checklist

Perform with Test Mode plans and credentials in a staging environment. Never run these tests against the production Live key or real customers.

- [ ] Free users see paid checkout disabled until recurring configuration is reported ready.
- [ ] Pro and Business Plan IDs resolve to active INR monthly Plans whose amounts match the catalog.
- [ ] Create a recurring subscription and complete checkout authorization; verify no paid entitlement is granted while Razorpay still reports a non-active state.
- [ ] Deliver subscription.activated before the browser callback and confirm the webhook persists the current subscription ID and activates the correct tier.
- [ ] Replay the same event and deliver an older event after a newer event; neither should create duplicate activation or restore a cancelled subscription.
- [ ] Deliver subscription.charged and confirm the billing period/last-payment timestamp updates.
- [ ] Deliver subscription.pending / subscription.halted with a still-current paid period and confirm that existing paid access remains. Advance to a past period end in a staging fixture and confirm the effective quota returns to Free.
- [ ] Schedule Pro ↔ Business at cycle end and confirm the current quota remains in effect until Razorpay applies the new Plan.
- [ ] Cancel renewal and confirm the current paid tier remains available until period end; confirm an abandoned new checkout can be cancelled without cancelling the existing paid Subscription.
- [ ] Repeat for workspace subscriptions and verify owner/admin-only checkout, cancellation, audit event and quota behavior.
- [ ] Keep the legacy one-time checkout path test covered for in-flight Orders.
- [ ] Check the Razorpay webhook dashboard reports successful 2xx delivery for the configured subscription events.

## Rollout / rollback

This PR does not mutate the production database, configure Razorpay credentials, create Plans, initiate payments, or deploy the branch. Before deploying the code, review and apply the additive schema migration to staging and validate the checks above. Production rollout should be a separate, explicitly approved step after the migration history is aligned, Live Plan IDs are confirmed against the production catalog, and the Live webhook secret/events are configured.

If rollback is needed after a recurring subscription was created, do not delete the new columns or switch entitlements blindly. First preserve provider IDs and paid period timestamps, keep the webhook handler available to reconcile existing subscriptions, disable new paid checkouts with configuration, and plan a reviewed forward migration if database changes need to be reverted.
