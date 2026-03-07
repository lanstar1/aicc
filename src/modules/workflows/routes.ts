import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { runOrderAutoWorkflow } from './order-auto-service';

const workflowLineSchema = z
  .object({
    productId: z.string().uuid().optional(),
    productCode: z.string().trim().optional(),
    qty: z.coerce.number().positive(),
    unitPrice: z.coerce.number().nonnegative().optional()
  })
  .refine((value) => Boolean(value.productId || value.productCode), {
    message: 'productId or productCode is required'
  });

const orderAutoBodySchema = z.object({
  callSessionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  customerType: z.enum(['existing', 'new']).optional(),
  draftKind: z.enum(['sale', 'quote']).default('sale'),
  shippingMethod: z.string().trim().min(1),
  warehouseCode: z.enum(['10', '30']).optional(),
  prepaymentNoticeSent: z.boolean().default(false),
  persistDraft: z.boolean().default(true),
  autoSaveToErp: z.boolean().default(true),
  lines: z.array(workflowLineSchema).min(1)
});

const workflowRoutes: FastifyPluginAsync = async (app) => {
  app.post('/order-auto', async (request) => {
    const body = orderAutoBodySchema.parse(request.body);
    const input: Parameters<typeof runOrderAutoWorkflow>[1] = {
      draftKind: body.draftKind,
      shippingMethod: body.shippingMethod,
      prepaymentNoticeSent: body.prepaymentNoticeSent,
      persistDraft: body.persistDraft,
      autoSaveToErp: body.autoSaveToErp,
      lines: body.lines.map((line) => {
        const item: Parameters<typeof runOrderAutoWorkflow>[1]['lines'][number] = {
          qty: line.qty
        };

        if (line.productId) {
          item.productId = line.productId;
        }

        if (line.productCode) {
          item.productCode = line.productCode;
        }

        if (line.unitPrice !== undefined) {
          item.unitPrice = line.unitPrice;
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

    if (body.customerType) {
      input.customerType = body.customerType;
    }

    if (body.warehouseCode) {
      input.warehouseCode = body.warehouseCode;
    }

    return runOrderAutoWorkflow(app, input);
  });
};

export default workflowRoutes;
