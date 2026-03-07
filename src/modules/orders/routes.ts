import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { createHttpError } from '../../lib/http';
import { persistOrderDraft, type CreateOrderDraftInput } from './service';

const orderLineSchema = z.object({
  productId: z.string().uuid().optional(),
  productCode: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  matchedModelName: z.string().trim().optional(),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  supplyAmount: z.coerce.number().nonnegative().optional(),
  vatAmount: z.coerce.number().nonnegative().optional(),
  totalAmount: z.coerce.number().nonnegative().optional(),
  pricePolicy: z.enum(['out_price1', 'out_price2', 'guide_price', 'manual']).default('manual'),
  inventoryStatus: z.enum(['available', 'short', 'check_needed']).default('check_needed'),
  matchConfidence: z.coerce.number().min(0).max(1).optional(),
  notes: z.string().trim().optional()
});

const createOrderDraftBodySchema = z.object({
  callSessionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  draftKind: z.enum(['sale', 'quote']),
  warehouseCode: z.enum(['10', '30']).default('10'),
  shippingMethod: z.string().trim().min(1),
  remarkText: z.string().trim().optional(),
  prepaymentRequired: z.boolean().default(false),
  prepaymentNoticeSent: z.boolean().default(false),
  requiresHumanReview: z.boolean().default(false),
  humanReviewReason: z.string().trim().optional(),
  lines: z.array(orderLineSchema).min(1)
});

const listOrderDraftsQuerySchema = z.object({
  status: z.enum(['draft', 'confirmed', 'erp_saved', 'human_checked', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const orderRoutes: FastifyPluginAsync = async (app) => {
  app.get('/drafts', async (request) => {
    const query = listOrderDraftsQuerySchema.parse(request.query);
    const result = await app.db.query(
      `
        select
          id,
          draft_kind,
          customer_id,
          warehouse_code,
          shipping_method,
          remark_text,
          prepayment_required,
          prepayment_notice_sent,
          requires_human_review,
          human_review_reason,
          total_amount,
          status,
          erp_slip_no,
          created_at,
          updated_at
        from aicc.order_draft
        where ($1::aicc.draft_status_t is null or status = $1)
        order by created_at desc
        limit $2
      `,
      [query.status ?? null, query.limit]
    );

    return {
      items: result.rows
    };
  });

  app.get('/drafts/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const [draftResult, lineResult] = await Promise.all([
      app.db.query('select * from aicc.order_draft where id = $1', [params.id]),
      app.db.query(
        `
          select *
          from aicc.order_draft_line
          where order_draft_id = $1
          order by created_at asc
        `,
        [params.id]
      )
    ]);

    if (draftResult.rowCount === 0) {
      throw createHttpError(404, 'Order draft not found');
    }

    return {
      ...draftResult.rows[0],
      lines: lineResult.rows
    };
  });

  app.post('/drafts', async (request, reply) => {
    const body = createOrderDraftBodySchema.parse(request.body);
    const input: CreateOrderDraftInput = {
      draftKind: body.draftKind,
      warehouseCode: body.warehouseCode,
      shippingMethod: body.shippingMethod,
      prepaymentRequired: body.prepaymentRequired,
      prepaymentNoticeSent: body.prepaymentNoticeSent,
      requiresHumanReview: body.requiresHumanReview,
      lines: body.lines.map((line) => {
        const item: CreateOrderDraftInput['lines'][number] = {
          productCode: line.productCode,
          productName: line.productName,
          qty: line.qty,
          pricePolicy: line.pricePolicy,
          inventoryStatus: line.inventoryStatus
        };

        if (line.productId) {
          item.productId = line.productId;
        }

        if (line.brand) {
          item.brand = line.brand;
        }

        if (line.matchedModelName) {
          item.matchedModelName = line.matchedModelName;
        }

        if (line.unitPrice !== undefined) {
          item.unitPrice = line.unitPrice;
        }

        if (line.supplyAmount !== undefined) {
          item.supplyAmount = line.supplyAmount;
        }

        if (line.vatAmount !== undefined) {
          item.vatAmount = line.vatAmount;
        }

        if (line.totalAmount !== undefined) {
          item.totalAmount = line.totalAmount;
        }

        if (line.matchConfidence !== undefined) {
          item.matchConfidence = line.matchConfidence;
        }

        if (line.notes) {
          item.notes = line.notes;
        }

        return item;
      })
    };

    if (body.callSessionId) {
      input.callSessionId = body.callSessionId;
    }

    if (body.customerId) {
      input.customerId = body.customerId;
    }

    if (body.remarkText) {
      input.remarkText = body.remarkText;
    }

    if (body.humanReviewReason) {
      input.humanReviewReason = body.humanReviewReason;
    }

    const draft = await persistOrderDraft(app, input);

    return reply.status(201).send(draft);
  });
};

export default orderRoutes;
