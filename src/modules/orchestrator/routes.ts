import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { createHttpError } from '../../lib/http';
import {
  analyzeTurn,
  buildOrderPreview,
  type AnalyzeTurnInput,
  type OrderPreviewInput,
  type ConversationState
} from './service';

const conversationStateSchema = z.object({
  intentType: z.enum(['order', 'inventory', 'quote', 'tech', 'other']).optional(),
  customerId: z.string().uuid().optional(),
  customerConfirmed: z.boolean().optional(),
  customerType: z.enum(['existing', 'new']).optional(),
  brand: z.string().trim().optional(),
  productQuery: z.string().trim().optional(),
  productId: z.string().uuid().optional(),
  productCode: z.string().trim().optional(),
  productName: z.string().trim().optional(),
  qty: z.coerce.number().positive().optional(),
  shippingMethod: z
    .enum([
      'delivery',
      'pickup',
      'courier_rogen',
      'courier_kd_parcel',
      'courier_kd_freight',
      'quick'
    ])
    .optional(),
  warehouseCode: z.enum(['10', '30']).optional(),
  assistantRepeatCount: z.coerce.number().int().min(0).optional(),
  repeatedQuestionCount: z.coerce.number().int().min(0).optional(),
  elapsedSeconds: z.coerce.number().int().min(0).optional()
});

const analyzeTurnBodySchema = z.object({
  callSessionId: z.string().uuid().optional(),
  callerNumber: z.string().trim().optional(),
  utterance: z.string().trim().min(1),
  persistEvent: z.boolean().default(true),
  hints: z
    .object({
      customerName: z.string().trim().optional(),
      brand: z.string().trim().optional(),
      productQuery: z.string().trim().optional(),
      qty: z.coerce.number().positive().optional(),
      shippingMethod: z.string().trim().optional()
    })
    .optional(),
  state: conversationStateSchema.optional()
});

const orderPreviewLineSchema = z
  .object({
    productId: z.string().uuid().optional(),
    productCode: z.string().trim().optional(),
    qty: z.coerce.number().positive(),
    unitPrice: z.coerce.number().nonnegative().optional()
  })
  .refine((value) => Boolean(value.productId || value.productCode), {
    message: 'productId or productCode is required'
  });

const orderPreviewBodySchema = z.object({
  callSessionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  customerType: z.enum(['existing', 'new']).optional(),
  draftKind: z.enum(['sale', 'quote']).default('sale'),
  shippingMethod: z.string().trim().min(1),
  warehouseCode: z.enum(['10', '30']).optional(),
  prepaymentNoticeSent: z.boolean().default(false),
  lines: z.array(orderPreviewLineSchema).min(1)
});

const orchestratorRoutes: FastifyPluginAsync = async (app) => {
  app.post('/turns', async (request) => {
    const body = analyzeTurnBodySchema.parse(request.body);
    const input: AnalyzeTurnInput = {
      utterance: body.utterance,
      persistEvent: body.persistEvent
    };

    if (body.callSessionId) {
      input.callSessionId = body.callSessionId;
    }

    if (body.callerNumber) {
      input.callerNumber = body.callerNumber;
    }

    if (body.hints) {
      const hints: AnalyzeTurnInput['hints'] = {};

      if (body.hints.customerName) {
        hints.customerName = body.hints.customerName;
      }

      if (body.hints.brand) {
        hints.brand = body.hints.brand;
      }

      if (body.hints.productQuery) {
        hints.productQuery = body.hints.productQuery;
      }

      if (body.hints.qty !== undefined) {
        hints.qty = body.hints.qty;
      }

      if (body.hints.shippingMethod) {
        hints.shippingMethod = body.hints.shippingMethod;
      }

      input.hints = hints;
    }

    if (body.state) {
      input.state = body.state as ConversationState;
    }

    return analyzeTurn(app, input);
  });

  app.post('/order-preview', async (request) => {
    const body = orderPreviewBodySchema.parse(request.body);
    const input: OrderPreviewInput = {
      draftKind: body.draftKind,
      shippingMethod: body.shippingMethod,
      prepaymentNoticeSent: body.prepaymentNoticeSent,
      lines: body.lines.map((line) => {
        const mappedLine: OrderPreviewInput['lines'][number] = {
          qty: line.qty
        };

        if (line.productId) {
          mappedLine.productId = line.productId;
        }

        if (line.productCode) {
          mappedLine.productCode = line.productCode;
        }

        if (line.unitPrice !== undefined) {
          mappedLine.unitPrice = line.unitPrice;
        }

        return mappedLine;
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

    try {
      return await buildOrderPreview(app, input);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Unsupported shipping method') {
          throw createHttpError(400, error.message);
        }

        if (error.message === 'Customer not found' || error.message === 'Product not found') {
          throw createHttpError(404, error.message);
        }
      }

      throw error;
    }
  });
};

export default orchestratorRoutes;
