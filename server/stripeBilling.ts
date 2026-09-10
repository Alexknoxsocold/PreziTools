import type { Express, Request, Response } from "express";
import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL?.trim();
const billingPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

let tableReady: Promise<void> | null = null;

async function ensureTables(): Promise<void> {
  if (!billingPool) throw new Error("DATABASE_URL is not configured");
  if (!tableReady) {
    tableReady = (async () => {
      await billingPool.query(`
        CREATE TABLE IF NOT EXISTS stripe_memberships (
          email TEXT PRIMARY KEY,
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          status TEXT NOT NULL DEFAULT 'inactive',
          pro_access BOOLEAN NOT NULL DEFAULT FALSE,
          current_period_end TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await billingPool.query(`
        CREATE TABLE IF NOT EXISTS stripe_webhook_events (
          event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch(error => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toDateFromUnix(value: unknown): Date | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(",").map(part => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean);
  if (!timestamp || signatures.length === 0) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNumber) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  return signatures.some(signature => {
    try {
      const actualBuffer = Buffer.from(signature, "utf8");
      return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
    } catch {
      return false;
    }
  });
}

async function markEvent(eventId: string, eventType: string): Promise<boolean> {
  if (!billingPool) return false;
  const result = await billingPool.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [eventId, eventType]
  );
  return result.rowCount === 1;
}

async function upsertFromCheckout(session: Record<string, any>): Promise<void> {
  if (!billingPool) throw new Error("Billing database unavailable");
  const customerDetails = session.customer_details && typeof session.customer_details === "object" ? session.customer_details : {};
  const email = normalizeEmail(customerDetails.email || session.customer_email);
  if (!email) return;

  const customerId = safeString(session.customer);
  const subscriptionId = safeString(session.subscription);
  const paid = session.payment_status === "paid" || session.status === "complete";

  await billingPool.query(`
    INSERT INTO stripe_memberships (email, stripe_customer_id, stripe_subscription_id, status, pro_access, updated_at)
    VALUES ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (email) DO UPDATE SET
      stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, stripe_memberships.stripe_customer_id),
      stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, stripe_memberships.stripe_subscription_id),
      status = EXCLUDED.status,
      pro_access = EXCLUDED.pro_access,
      updated_at = NOW()
  `, [email, customerId, subscriptionId, paid ? "active" : "pending", paid]);
}

async function applySubscriptionEvent(type: string, subscription: Record<string, any>): Promise<void> {
  if (!billingPool) throw new Error("Billing database unavailable");
  const subscriptionId = safeString(subscription.id);
  const customerId = safeString(subscription.customer);
  if (!subscriptionId && !customerId) return;

  const status = safeString(subscription.status) || (type === "customer.subscription.deleted" ? "canceled" : "inactive");
  const active = type !== "customer.subscription.deleted" && ["active", "trialing"].includes(status);
  const periodEnd = toDateFromUnix(subscription.current_period_end);

  await billingPool.query(`
    UPDATE stripe_memberships
    SET stripe_subscription_id = COALESCE($1, stripe_subscription_id),
        stripe_customer_id = COALESCE($2, stripe_customer_id),
        status = $3,
        pro_access = $4,
        current_period_end = $5,
        updated_at = NOW()
    WHERE ($1 IS NOT NULL AND stripe_subscription_id = $1)
       OR ($2 IS NOT NULL AND stripe_customer_id = $2)
  `, [subscriptionId, customerId, status, active, periodEnd]);
}

async function handleStripeWebhook(req: Request, res: Response) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) return res.status(503).json({ error: "Stripe webhook secret is not configured" });

    const signature = req.get("stripe-signature");
    if (!signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Invalid webhook payload" });
    if (!verifyStripeSignature(req.body, signature, secret)) return res.status(401).json({ error: "Invalid Stripe signature" });

    await ensureTables();
    const event = JSON.parse(req.body.toString("utf8")) as { id?: string; type?: string; data?: { object?: Record<string, any> } };
    const eventId = safeString(event.id);
    const eventType = safeString(event.type);
    if (!eventId || !eventType) return res.status(400).json({ error: "Stripe event metadata missing" });

    const firstDelivery = await markEvent(eventId, eventType);
    if (!firstDelivery) return res.json({ received: true, duplicate: true });

    const object = event.data?.object && typeof event.data.object === "object" ? event.data.object : {};
    if (eventType === "checkout.session.completed") await upsertFromCheckout(object);
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(eventType)) {
      await applySubscriptionEvent(eventType, object);
    }

    return res.json({ received: true, type: eventType });
  } catch (error) {
    console.error("[Stripe] Webhook processing failed:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

async function getBillingStatus(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-store");
    if (!req.user) return res.json({ authenticated: false, plan: "free", pro: false });
    await ensureTables();
    if (!billingPool) return res.status(503).json({ error: "Billing database unavailable" });

    const email = normalizeEmail(req.user.email);
    const result = await billingPool.query(
      `SELECT status, pro_access, current_period_end, updated_at FROM stripe_memberships WHERE email = $1 LIMIT 1`,
      [email]
    );
    const row = result.rows[0] as undefined | { status: string; pro_access: boolean; current_period_end: Date | string | null; updated_at: Date | string };

    return res.json({
      authenticated: true,
      plan: row?.pro_access ? "pro" : "free",
      pro: Boolean(row?.pro_access),
      status: row?.status ?? "inactive",
      renewalPeriodEnd: row?.current_period_end ?? null,
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    console.error("[Stripe] Billing status failed:", error);
    return res.status(500).json({ error: "Unable to load billing status" });
  }
}

function getCheckoutUrl(req: Request, res: Response) {
  if (!req.user) return res.status(401).json({ error: "Sign in required" });
  const base = process.env.STRIPE_PAYMENT_LINK?.trim();
  if (!base) return res.status(503).json({ error: "Stripe checkout is not configured" });
  try {
    const url = new URL(base);
    url.searchParams.set("prefilled_email", req.user.email);
    return res.json({ url: url.toString() });
  } catch {
    return res.status(500).json({ error: "Stripe checkout URL is invalid" });
  }
}

export function registerStripeWebhook(app: Express) {
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), handleStripeWebhook);
}

export function registerStripeBillingRoutes(app: Express) {
  app.get("/api/billing/status", getBillingStatus);
  app.get("/api/billing/checkout-url", getCheckoutUrl);
}
