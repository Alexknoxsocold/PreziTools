import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL?.trim();
const billingPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
type RawBodyRequest = Request & { rawBody?: Buffer };

let tableReady: Promise<void> | null = null;

async function ensureBillingTables(): Promise<void> {
  if (!billingPool) throw new Error("DATABASE_URL is not configured");
  if (!tableReady) {
    tableReady = (async () => {
      await billingPool.query(`
        CREATE TABLE IF NOT EXISTS whop_memberships (
          email TEXT PRIMARY KEY,
          whop_membership_id TEXT,
          whop_user_id TEXT,
          product_id TEXT,
          plan_id TEXT,
          status TEXT NOT NULL DEFAULT 'inactive',
          pro_access BOOLEAN NOT NULL DEFAULT FALSE,
          manage_url TEXT,
          renewal_period_end TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await billingPool.query(`
        CREATE TABLE IF NOT EXISTS whop_webhook_events (
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

function signatureMatches(expected: Buffer, encoded: string): boolean {
  try {
    const actual = Buffer.from(encoded, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function verifyWhopWebhook(req: Request, rawBody: string): boolean {
  const secret = process.env.WHOP_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const messageId = req.get("webhook-id");
  const timestamp = req.get("webhook-timestamp");
  const signatureHeader = req.get("webhook-signature");
  if (!messageId || !timestamp || !signatureHeader) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNumber) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const signedPayload = `${messageId}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(signedPayload).digest();
  return signatureHeader
    .split(/\s+/)
    .map(part => part.split(",", 2))
    .some(([version, signature]) => version === "v1" && !!signature && signatureMatches(expected, signature));
}

function isConfiguredProProduct(data: Record<string, unknown>): boolean {
  const configuredProduct = process.env.WHOP_PRO_PRODUCT_ID?.trim();
  const configuredPlan = process.env.WHOP_PRO_PLAN_ID?.trim();
  const product = data.product && typeof data.product === "object" ? data.product as Record<string, unknown> : {};
  const plan = data.plan && typeof data.plan === "object" ? data.plan as Record<string, unknown> : {};
  const productId = safeString(product.id);
  const planId = safeString(plan.id);

  if (configuredProduct && productId && configuredProduct !== productId) return false;
  if (configuredPlan && planId && configuredPlan !== planId) return false;
  return Boolean(configuredProduct || configuredPlan);
}

async function markEvent(eventId: string, eventType: string): Promise<boolean> {
  if (!billingPool) return false;
  const result = await billingPool.query(
    `INSERT INTO whop_webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [eventId, eventType]
  );
  return result.rowCount === 1;
}

async function applyMembershipEvent(type: string, data: Record<string, unknown>): Promise<void> {
  if (!billingPool) throw new Error("Billing database unavailable");
  if (!isConfiguredProProduct(data)) return;

  const user = data.user && typeof data.user === "object" ? data.user as Record<string, unknown> : {};
  const product = data.product && typeof data.product === "object" ? data.product as Record<string, unknown> : {};
  const plan = data.plan && typeof data.plan === "object" ? data.plan as Record<string, unknown> : {};
  const email = normalizeEmail(user.email);
  if (!email) throw new Error("Whop membership event did not include a user email");

  const active = type === "membership.activated";
  const renewalEnd = safeString(data.renewal_period_end);
  await billingPool.query(`
    INSERT INTO whop_memberships (
      email, whop_membership_id, whop_user_id, product_id, plan_id, status,
      pro_access, manage_url, renewal_period_end, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (email) DO UPDATE SET
      whop_membership_id = EXCLUDED.whop_membership_id,
      whop_user_id = EXCLUDED.whop_user_id,
      product_id = EXCLUDED.product_id,
      plan_id = EXCLUDED.plan_id,
      status = EXCLUDED.status,
      pro_access = EXCLUDED.pro_access,
      manage_url = EXCLUDED.manage_url,
      renewal_period_end = EXCLUDED.renewal_period_end,
      updated_at = NOW()
  `, [
    email,
    safeString(data.id),
    safeString(user.id),
    safeString(product.id),
    safeString(plan.id),
    active ? "active" : "inactive",
    active,
    safeString(data.manage_url),
    renewalEnd,
  ]);
}

async function handleWhopWebhook(req: RawBodyRequest, res: Response) {
  try {
    const rawBuffer = req.rawBody;
    if (!Buffer.isBuffer(rawBuffer)) return res.status(400).json({ error: "Raw webhook body unavailable" });
    const rawBody = rawBuffer.toString("utf8");

    if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
      return res.status(503).json({ error: "Whop webhook secret is not configured" });
    }
    if (!verifyWhopWebhook(req, rawBody)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    await ensureBillingTables();
    const event = JSON.parse(rawBody) as { id?: unknown; type?: unknown; data?: unknown };
    const eventId = safeString(event.id) || req.get("webhook-id") || "";
    const type = safeString(event.type) || "unknown";
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
    if (!eventId) return res.status(400).json({ error: "Webhook event id missing" });

    const firstDelivery = await markEvent(eventId, type);
    if (!firstDelivery) return res.json({ received: true, duplicate: true });

    if (type === "membership.activated" || type === "membership.deactivated") {
      await applyMembershipEvent(type, data);
    }

    return res.json({ received: true, type });
  } catch (error) {
    console.error("[Whop] Webhook processing failed:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

async function getBillingStatus(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-store");
    if (!req.user) return res.json({ authenticated: false, plan: "free", pro: false });
    await ensureBillingTables();
    if (!billingPool) return res.status(503).json({ error: "Billing database unavailable" });

    const email = normalizeEmail(req.user.email);
    const result = await billingPool.query(
      `SELECT status, pro_access, manage_url, renewal_period_end, updated_at FROM whop_memberships WHERE email = $1 LIMIT 1`,
      [email]
    );
    const row = result.rows[0] as undefined | {
      status: string;
      pro_access: boolean;
      manage_url: string | null;
      renewal_period_end: Date | string | null;
      updated_at: Date | string;
    };

    return res.json({
      authenticated: true,
      plan: row?.pro_access ? "pro" : "free",
      pro: Boolean(row?.pro_access),
      status: row?.status ?? "inactive",
      manageUrl: row?.manage_url ?? null,
      renewalPeriodEnd: row?.renewal_period_end ?? null,
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    console.error("[Whop] Billing status failed:", error);
    return res.status(500).json({ error: "Unable to load billing status" });
  }
}

export function registerWhopBillingRoutes(app: Express) {
  app.post("/api/webhooks/whop", handleWhopWebhook);
  app.get("/api/billing/status", getBillingStatus);
  app.get("/api/billing/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      whopApiKeyConfigured: Boolean(process.env.WHOP_COMPANY_API_KEY?.trim()),
      whopWebhookConfigured: Boolean(process.env.WHOP_WEBHOOK_SECRET?.trim()),
      proProductConfigured: Boolean(process.env.WHOP_PRO_PRODUCT_ID?.trim()),
      proPlanConfigured: Boolean(process.env.WHOP_PRO_PLAN_ID?.trim()),
    });
  });
}
