import type { FastifyInstance } from 'fastify';

import { getDeliveryRemark, parseDeliveryMethod } from '../../lib/delivery';
import { createHttpError } from '../../lib/http';

export type OrderLineInput = {
  productId?: string;
  productCode: string;
  productName: string;
  brand?: string;
  matchedModelName?: string;
  qty: number;
  unitPrice?: number;
  supplyAmount?: number;
  vatAmount?: number;
  totalAmount?: number;
  pricePolicy: 'out_price1' | 'out_price2' | 'guide_price' | 'manual';
  inventoryStatus: 'available' | 'short' | 'check_needed';
  matchConfidence?: number;
  notes?: string;
};

export type CreateOrderDraftInput = {
  callSessionId?: string;
  customerId?: string;
  draftKind: 'sale' | 'quote';
  warehouseCode: '10' | '30';
  shippingMethod: string;
  remarkText?: string;
  prepaymentRequired: boolean;
  prepaymentNoticeSent: boolean;
  requiresHumanReview: boolean;
  humanReviewReason?: string;
  lines: OrderLineInput[];
};

export function calculateLineAmounts(line: OrderLineInput) {
  const supplyAmount =
    line.supplyAmount ?? (line.unitPrice !== undefined ? Number((line.unitPrice * line.qty).toFixed(2)) : null);
  const vatAmount =
    line.vatAmount ?? (supplyAmount !== null ? Number((supplyAmount * 0.1).toFixed(2)) : null);
  const totalAmount =
    line.totalAmount ?? (supplyAmount !== null && vatAmount !== null ? supplyAmount + vatAmount : null);

  return {
    supplyAmount,
    vatAmount,
    totalAmount
  };
}

export async function persistOrderDraft(
  app: FastifyInstance,
  input: CreateOrderDraftInput
) {
  const shippingMethod = parseDeliveryMethod(input.shippingMethod);

  if (!shippingMethod) {
    throw createHttpError(400, 'Unsupported shippingMethod');
  }

  const remarkText = input.remarkText ?? getDeliveryRemark(shippingMethod);
  const calculatedLines = input.lines.map((line) => ({
    ...line,
    ...calculateLineAmounts(line)
  }));

  const totalSupplyAmount = calculatedLines.reduce((sum, line) => sum + (line.supplyAmount ?? 0), 0);
  const totalVatAmount = calculatedLines.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0);
  const totalAmount = calculatedLines.reduce((sum, line) => sum + (line.totalAmount ?? 0), 0);

  const client = await app.db.connect();

  try {
    await client.query('begin');

    const draftResult = await client.query(
      `
        insert into aicc.order_draft (
          call_session_id,
          customer_id,
          draft_kind,
          warehouse_code,
          shipping_method,
          remark_text,
          prepayment_required,
          prepayment_notice_sent,
          requires_human_review,
          human_review_reason,
          total_supply_amount,
          total_vat_amount,
          total_amount
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        returning *
      `,
      [
        input.callSessionId ?? null,
        input.customerId ?? null,
        input.draftKind,
        input.warehouseCode,
        shippingMethod,
        remarkText,
        input.prepaymentRequired,
        input.prepaymentNoticeSent,
        input.requiresHumanReview,
        input.humanReviewReason ?? null,
        totalSupplyAmount,
        totalVatAmount,
        totalAmount
      ]
    );

    const draft = draftResult.rows[0];

    for (const line of calculatedLines) {
      await client.query(
        `
          insert into aicc.order_draft_line (
            order_draft_id,
            product_id,
            product_code,
            product_name,
            brand,
            matched_model_name,
            qty,
            unit_price,
            supply_amount,
            vat_amount,
            total_amount,
            price_policy,
            inventory_status,
            match_confidence,
            notes
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `,
        [
          draft.id,
          line.productId ?? null,
          line.productCode,
          line.productName,
          line.brand ?? null,
          line.matchedModelName ?? null,
          line.qty,
          line.unitPrice ?? null,
          line.supplyAmount,
          line.vatAmount,
          line.totalAmount,
          line.pricePolicy,
          line.inventoryStatus,
          line.matchConfidence ?? null,
          line.notes ?? null
        ]
      );
    }

    await client.query('commit');

    return {
      ...draft,
      lines: calculatedLines
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
