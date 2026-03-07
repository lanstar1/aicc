import type { FastifyInstance } from 'fastify';

import { buildOrderPreview } from '../orchestrator/service';
import { saveDraftToEcount } from '../erp/draft-service';
import { autoSendOrderDraftSummary } from '../notifications/service';
import { persistOrderDraft, type CreateOrderDraftInput } from '../orders/service';

export type OrderAutoWorkflowInput = {
  callSessionId?: string;
  customerId?: string;
  customerType?: 'existing' | 'new';
  draftKind: 'sale' | 'quote';
  shippingMethod: string;
  warehouseCode?: '10' | '30';
  prepaymentNoticeSent?: boolean;
  persistDraft?: boolean;
  autoSaveToErp?: boolean;
  lines: Array<{
    productId?: string;
    productCode?: string;
    qty: number;
    unitPrice?: number;
  }>;
};

export async function runOrderAutoWorkflow(
  app: FastifyInstance,
  input: OrderAutoWorkflowInput
) {
  const persistDraft = input.persistDraft ?? true;
  const previewInput: Parameters<typeof buildOrderPreview>[1] = {
    draftKind: input.draftKind,
    shippingMethod: input.shippingMethod,
    lines: input.lines.map((line) => {
      const item: Parameters<typeof buildOrderPreview>[1]['lines'][number] = {
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

  if (input.prepaymentNoticeSent !== undefined) {
    previewInput.prepaymentNoticeSent = input.prepaymentNoticeSent;
  }

  if (input.callSessionId) {
    previewInput.callSessionId = input.callSessionId;
  }

  if (input.customerId) {
    previewInput.customerId = input.customerId;
  }

  if (input.customerType) {
    previewInput.customerType = input.customerType;
  }

  if (input.warehouseCode) {
    previewInput.warehouseCode = input.warehouseCode;
  }

  const preview = await buildOrderPreview(app, previewInput);
  let draft = null;

  let erp = null;
  let autoSaved = false;
  let notification: {
    attempted: boolean;
    reason?: string;
    channel?: 'email' | 'sms' | 'alimtalk';
    recipient?: string;
    queued?: unknown;
    sent?: unknown;
    error?: string;
  } | null = null;

  if (persistDraft) {
    const draftInput: CreateOrderDraftInput = {
      draftKind: preview.draftPayload.draftKind,
      warehouseCode: preview.draftPayload.warehouseCode,
      shippingMethod: preview.draftPayload.shippingMethod,
      prepaymentRequired: preview.draftPayload.prepaymentRequired,
      prepaymentNoticeSent: preview.draftPayload.prepaymentNoticeSent,
      requiresHumanReview: preview.draftPayload.requiresHumanReview,
      lines: preview.draftPayload.lines.map((line) => {
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

    if (preview.draftPayload.callSessionId) {
      draftInput.callSessionId = preview.draftPayload.callSessionId;
    }

    if (preview.draftPayload.customerId) {
      draftInput.customerId = preview.draftPayload.customerId;
    }

    if (preview.draftPayload.remarkText) {
      draftInput.remarkText = preview.draftPayload.remarkText;
    }

    if (preview.draftPayload.humanReviewReason) {
      draftInput.humanReviewReason = preview.draftPayload.humanReviewReason;
    }

    draft = await persistOrderDraft(app, draftInput);

    if ((input.autoSaveToErp ?? true) && !preview.requiresHumanReview) {
      erp = await saveDraftToEcount(app, draft.id, input.draftKind);
      autoSaved = true;
    }

    try {
      notification = await autoSendOrderDraftSummary(app, {
        draftId: draft.id
      });
    } catch (error) {
      notification = {
        attempted: true,
        error: error instanceof Error ? error.message : 'notification_failed'
      };
    }
  }

  return {
    preview,
    draft,
    autoSaved,
    erp,
    notification,
    nextStep: !persistDraft
      ? 'preview_only'
      : autoSaved
        ? 'erp_saved'
        : preview.requiresHumanReview
          ? 'human_review_required'
          : 'draft_saved'
  };
}
