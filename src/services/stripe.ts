import Stripe from 'stripe';
import { query, queryOne, queryAll, transaction } from './db.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

interface SubscriptionData {
  tenantId: string;
  planId: string;
  stripeCustomerId?: string;
}

/**
 * Initialise Stripe
 */
export function getStripeClient(): Stripe {
  return stripe;
}

/**
 * Récupère ou crée un customer Stripe
 */
export async function getOrCreateStripeCustomer(tenantId: string, email: string, name?: string) {
  // Vérifier si le customer existe déjà
  const subscription = await queryOne(
    `SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );

  if (subscription?.stripe_customer_id) {
    return { id: subscription.stripe_customer_id };
  }

  // Créer un nouveau customer
  const customer = await stripe.customers.create({
    email,
    name: name || tenantId,
    metadata: {
      tenantId,
    },
  });

  return customer;
}

/**
 * Crée une subscription
 */
export async function createSubscription(data: SubscriptionData) {
  return transaction(async (client) => {
    const { tenantId, planId, stripeCustomerId } = data;

    // Récupérer le plan
    const plan = await queryOne(
      `SELECT * FROM subscription_plans WHERE id = $1`,
      [planId]
    );

    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    // Créer la subscription Stripe
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId!,
      items: [
        {
          price: plan.stripe_price_id,
          quantity: 1,
        },
      ],
      trial_period_days: 14, // Trial period de 14 jours
      metadata: {
        tenantId,
        planId,
      },
    });

    // Sauvegarder en DB
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 jours

    await client.query(
      `INSERT INTO subscriptions 
       (tenant_id, plan_id, stripe_subscription_id, stripe_customer_id, status, current_period_start, current_period_end, trial_start, trial_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan_id = $2, stripe_subscription_id = $3, stripe_customer_id = $4, status = $5, updated_at = NOW()`,
      [
        tenantId,
        planId,
        subscription.id,
        stripeCustomerId,
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
        subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
        subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      ]
    );

    return subscription;
  });
}

/**
 * Met à jour une subscription
 */
export async function updateSubscription(tenantId: string, planId: string) {
  const subscription = await queryOne(
    `SELECT * FROM subscriptions WHERE tenant_id = $1`,
    [tenantId]
  );

  if (!subscription) {
    throw new Error(`Subscription not found for tenant: ${tenantId}`);
  }

  const plan = await queryOne(
    `SELECT * FROM subscription_plans WHERE id = $1`,
    [planId]
  );

  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  // Mettre à jour la subscription Stripe
  const updated = await stripe.subscriptions.update(
    subscription.stripe_subscription_id,
    {
      items: [
        {
          id: (subscription as any).items.data[0].id,
          price: plan.stripe_price_id,
        },
      ],
    }
  );

  // Mettre à jour en DB
  await query(
    `UPDATE subscriptions SET plan_id = $1, updated_at = NOW() WHERE tenant_id = $2`,
    [planId, tenantId]
  );

  return updated;
}

/**
 * Annule une subscription
 */
export async function cancelSubscription(tenantId: string, atPeriodEnd = true) {
  const subscription = await queryOne(
    `SELECT * FROM subscriptions WHERE tenant_id = $1`,
    [tenantId]
  );

  if (!subscription) {
    throw new Error(`Subscription not found for tenant: ${tenantId}`);
  }

  // Annuler la subscription Stripe
  const cancelled = await stripe.subscriptions.update(
    subscription.stripe_subscription_id,
    {
      cancel_at_period_end: atPeriodEnd,
    }
  );

  // Mettre à jour en DB
  await query(
    `UPDATE subscriptions 
     SET status = $1, cancel_at_period_end = $2, canceled_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $3`,
    [cancelled.status, atPeriodEnd, tenantId]
  );

  return cancelled;
}

/**
 * Récupère la subscription d'un tenant
 */
export async function getTenantSubscription(tenantId: string) {
  return queryOne(
    `SELECT s.*, p.name as plan_name, p.price_usd, p.features
     FROM subscriptions s
     JOIN subscription_plans p ON s.plan_id = p.id
     WHERE s.tenant_id = $1`,
    [tenantId]
  );
}

/**
 * Enregistre une facture
 */
export async function recordInvoice(
  tenantId: string,
  subscriptionId: string,
  stripeInvoiceId: string,
  amountUsd: number,
  status: string,
  pdfUrl?: string
) {
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId);

  await query(
    `INSERT INTO invoices 
     (tenant_id, subscription_id, stripe_invoice_id, amount_usd, status, period_start, period_end, pdf_url, invoice_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      tenantId,
      subscriptionId,
      stripeInvoiceId,
      amountUsd,
      status,
      new Date(invoice.period_start * 1000),
      new Date(invoice.period_end * 1000),
      pdfUrl || invoice.pdf,
      invoice.hosted_invoice_url,
    ]
  );
}

/**
 * Gère les webhooks Stripe
 */
export async function handleStripeWebhook(event: Stripe.Event) {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('Subscription updated:', subscription.metadata?.tenantId);
      }
      break;

    case 'customer.subscription.deleted':
      {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;
        if (tenantId) {
          await query(
            `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE tenant_id = $1`,
            [tenantId]
          );
        }
      }
      break;

    case 'invoice.payment_succeeded':
      {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = invoice.metadata?.tenantId;
        if (tenantId) {
          await query(
            `UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE stripe_invoice_id = $1`,
            [invoice.id]
          );
        }
      }
      break;

    case 'invoice.payment_failed':
      {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = invoice.metadata?.tenantId;
        if (tenantId) {
          await query(
            `UPDATE subscriptions SET status = 'past_due' WHERE tenant_id = $1`,
            [tenantId]
          );
        }
      }
      break;
  }
}

/**
 * Récupère les invoices d'un tenant
 */
export async function getTenantInvoices(tenantId: string, limit = 10) {
  return queryAll(
    `SELECT * FROM invoices 
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );
}

/**
 * Récupère les usage metrics d'un tenant
 */
export async function getTenantUsageMetrics(tenantId: string, year: number, month: number) {
  return queryOne(
    `SELECT * FROM usage_metrics 
     WHERE tenant_id = $1 AND year = $2 AND month = $3`,
    [tenantId, year, month]
  );
}

/**
 * Met à jour les usage metrics
 */
export async function updateUsageMetrics(
  tenantId: string,
  year: number,
  month: number,
  updates: {
    documents_uploaded?: number;
    documents_processed?: number;
    api_calls?: number;
    storage_used_bytes?: number;
    embeddings_generated?: number;
  }
) {
  const columns = Object.keys(updates)
    .map((key, i) => `${key} = ${key} + $${i + 2}`)
    .join(', ');

  const values = Object.values(updates);

  await query(
    `INSERT INTO usage_metrics (tenant_id, year, month, ${Object.keys(updates).join(', ')})
     VALUES ($1, $2, $3, ${Object.keys(updates).map((_, i) => `$${i + 4}`).join(', ')})
     ON CONFLICT (tenant_id, year, month) DO UPDATE SET
       ${columns}`,
    [tenantId, year, month, ...values]
  );
}
