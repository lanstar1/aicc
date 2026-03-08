import type { FastifyInstance } from 'fastify';

import { deliveryMethodLabels } from '../../lib/delivery';
import {
  analyzeTurn,
  buildOrderPreview,
  type ConversationState,
  type IntentType
} from './service';
import { runOrderAutoWorkflow } from '../workflows/order-auto-service';

export type TurnAnalysis = Awaited<ReturnType<typeof analyzeTurn>>;
export type OrderPreviewResult = Awaited<ReturnType<typeof buildOrderPreview>>;
export type OrderWorkflowResult = Awaited<ReturnType<typeof runOrderAutoWorkflow>>;

export type TurnResponseResolution = {
  source: 'assistant_prompt' | 'grounded' | 'workflow' | 'workflow_failure' | 'none';
  responseText: string | null;
  preview: OrderPreviewResult | null;
  workflowResult: OrderWorkflowResult | null;
  statePatch: Partial<ConversationState> | null;
  error?: string;
};

export async function resolveTurnResponse(
  app: FastifyInstance,
  input: {
    analysis: TurnAnalysis;
    state: ConversationState;
    callSessionId?: string;
    persistDraft?: boolean;
    autoSaveToErp?: boolean;
  }
): Promise<TurnResponseResolution> {
  const workflow = await maybeRunConfirmedWorkflow(app, input);

  if (workflow) {
    return workflow;
  }

  const grounded = await maybeBuildGroundedResponse(app, input);

  if (grounded) {
    return grounded;
  }

  const responseText =
    typeof input.analysis.assistantPrompt === 'string'
      ? input.analysis.assistantPrompt.trim()
      : '';

  return {
    source: responseText ? 'assistant_prompt' : 'none',
    responseText: responseText || null,
    preview: null,
    workflowResult: null,
    statePatch: null
  };
}

export function buildApprovedTurnInstructions(
  responseText: string,
  input?: {
    handoffTarget?: 'sales' | 'tech' | 'none';
  }
) {
  const instructions = [
    'Reply in Korean in one short phone-friendly turn.',
    'Keep the reply to one task and usually one or two short sentences.',
    'If options are mentioned, mention at most two in one turn.',
    'If a confirmation is needed, end with one clear yes or no question.',
    'Use the approved LANstar response below as the main content of your next reply.',
    `Approved response: ${responseText}`,
    'Do not add new facts beyond the approved response and the established session instructions.'
  ];

  if (input?.handoffTarget === 'tech') {
    instructions.push('Make it clear that the technical staff will continue the call.');
  } else if (input?.handoffTarget === 'sales') {
    instructions.push('Make it clear that the sales staff will continue the call.');
  }

  return instructions.join(' ');
}

async function maybeRunConfirmedWorkflow(
  app: FastifyInstance,
  input: {
    analysis: TurnAnalysis;
    state: ConversationState;
    callSessionId?: string;
    persistDraft?: boolean;
    autoSaveToErp?: boolean;
  }
): Promise<TurnResponseResolution | null> {
  const { analysis, state } = input;

  if (analysis.nextAction !== 'save_order' && analysis.nextAction !== 'save_quote') {
    return null;
  }

  if ((!state.productId && !state.productCode) || !state.qty || !state.shippingMethod) {
    return null;
  }

  try {
    const lineInput: Parameters<typeof runOrderAutoWorkflow>[1]['lines'][number] = {
      qty: state.qty
    };

    if (state.productId) {
      lineInput.productId = state.productId;
    }

    if (state.productCode) {
      lineInput.productCode = state.productCode;
    }

    const workflowInput: Parameters<typeof runOrderAutoWorkflow>[1] = {
      draftKind: analysis.nextAction === 'save_quote' ? 'quote' : 'sale',
      shippingMethod: deliveryMethodLabels[state.shippingMethod],
      persistDraft: input.persistDraft ?? true,
      autoSaveToErp: (input.persistDraft ?? true) ? (input.autoSaveToErp ?? true) : false,
      lines: [lineInput]
    };

    if (input.callSessionId) {
      workflowInput.callSessionId = input.callSessionId;
    }

    if (state.customerId) {
      workflowInput.customerId = state.customerId;
    }

    if (state.customerType) {
      workflowInput.customerType = state.customerType;
    }

    if (state.warehouseCode) {
      workflowInput.warehouseCode = state.warehouseCode;
    }

    const workflowResult = await runOrderAutoWorkflow(app, workflowInput);

    return {
      source: 'workflow',
      responseText: buildWorkflowResponseText(workflowResult),
      preview: workflowResult.preview,
      workflowResult,
      statePatch: {
        orderConfirmed: false,
        pendingConfirmation: null
      }
    };
  } catch (error) {
    return {
      source: 'workflow_failure',
      responseText: buildWorkflowFailureText(analysis.intent),
      preview: null,
      workflowResult: null,
      statePatch: {
        orderConfirmed: false,
        pendingConfirmation: null
      },
      error: error instanceof Error ? error.message : 'workflow_failed'
    };
  }
}

async function maybeBuildGroundedResponse(
  app: FastifyInstance,
  input: {
    analysis: TurnAnalysis;
    state: ConversationState;
    callSessionId?: string;
  }
): Promise<TurnResponseResolution | null> {
  const { analysis, state } = input;

  if (analysis.nextAction === 'provide_tech_guidance') {
    const candidate = analysis.techCandidates[0];

    if (!candidate?.answerSnippet) {
      return null;
    }

    return {
      source: 'grounded',
      responseText: shortenForPhone(candidate.answerSnippet),
      preview: null,
      workflowResult: null,
      statePatch: null
    };
  }

  if (analysis.nextAction !== 'check_inventory' && analysis.nextAction !== 'provide_quote') {
    return null;
  }

  if ((!state.productId && !state.productCode) || analysis.productCandidates.length === 0) {
    return null;
  }

  const shippingMethodLabel = state.shippingMethod
    ? deliveryMethodLabels[state.shippingMethod]
    : analysis.customer?.isYongsanArea
      ? '배송'
      : '택배-로젠';
  const qty = state.qty ?? analysis.extracted.qty ?? 1;

  try {
    const previewLine: Parameters<typeof buildOrderPreview>[1]['lines'][number] = {
      qty
    };

    if (state.productId) {
      previewLine.productId = state.productId;
    }

    if (state.productCode) {
      previewLine.productCode = state.productCode;
    }

    const previewInput: Parameters<typeof buildOrderPreview>[1] = {
      draftKind: analysis.nextAction === 'provide_quote' ? 'quote' : 'sale',
      shippingMethod: shippingMethodLabel,
      warehouseCode: state.warehouseCode ?? '10',
      lines: [previewLine]
    };

    if (input.callSessionId) {
      previewInput.callSessionId = input.callSessionId;
    }

    if (state.customerId) {
      previewInput.customerId = state.customerId;
    }

    if (state.customerType) {
      previewInput.customerType = state.customerType;
    }

    const preview = await buildOrderPreview(app, previewInput);
    const line = preview.lines[0];

    if (!line) {
      return null;
    }

    const responseText =
      analysis.nextAction === 'check_inventory'
        ? buildInventoryResponse({
            productName: line.productName,
            qty,
            inventoryStatus: line.inventoryStatus,
            isYongsanArea: analysis.customer?.isYongsanArea ?? false
          })
        : buildQuoteResponse({
            productName: line.productName,
            qty,
            unitPrice: line.unitPrice ?? null,
            totalAmount: line.totalAmount ?? null,
            inventoryStatus: line.inventoryStatus,
            requiresHumanReview: preview.requiresHumanReview,
            prepaymentRequired: preview.prepaymentRequired
          });

    return {
      source: 'grounded',
      responseText,
      preview,
      workflowResult: null,
      statePatch: null
    };
  } catch {
    return {
      source: 'grounded',
      responseText:
        analysis.nextAction === 'provide_quote'
          ? '견적 확인 중입니다. 담당자가 확인 후 바로 이어서 안내드리겠습니다.'
          : '재고 확인 중입니다. 담당자가 확인 후 바로 이어서 안내드리겠습니다.',
      preview: null,
      workflowResult: null,
      statePatch: null
    };
  }
}

function buildWorkflowResponseText(result: OrderWorkflowResult) {
  const firstLine = result.preview.lines[0];
  const shippingLabel = result.preview.shippingMethodLabel;
  const productText = firstLine
    ? `${firstLine.productName} ${Number(firstLine.qty)}개`
    : '요청하신 품목';
  const prepaymentText = result.preview.prepaymentRequired
    ? ' 먼저 선결제해주셔야 당일 출고 가능합니다.'
    : '';
  const draftKindLabel =
    result.preview.draftPayload.draftKind === 'quote' ? '견적' : '주문';

  if (result.nextStep === 'erp_saved') {
    return `${productText} 기준으로 ${draftKindLabel} 접수가 완료되었습니다. ${shippingLabel}로 진행하겠습니다.${prepaymentText}`;
  }

  if (result.nextStep === 'human_review_required') {
    return `${productText} 기준으로 내용은 접수했습니다. 담당자가 최종 확인 후 바로 이어서 안내드리겠습니다.${prepaymentText}`;
  }

  if (result.nextStep === 'preview_only') {
    return `${productText} 기준으로 ${draftKindLabel} 접수 예정 내용까지 확인했습니다. ${shippingLabel} 기준으로 이어서 검토하겠습니다.${prepaymentText}`;
  }

  return `${productText} 기준으로 내용 확인했고 담당자가 이어서 확인하겠습니다.${prepaymentText}`;
}

function buildWorkflowFailureText(intent: IntentType) {
  return `${intent === 'quote' ? '견적' : '주문'} 내용을 확인했습니다. 담당자가 바로 이어서 최종 확인하겠습니다.`;
}

function buildInventoryResponse(input: {
  productName: string;
  qty: number;
  inventoryStatus: 'available' | 'short' | 'check_needed';
  isYongsanArea: boolean;
}) {
  if (input.inventoryStatus === 'available') {
    return `${input.productName} ${Number(input.qty)}개 기준으로 현재 출고 가능합니다.`;
  }

  if (input.inventoryStatus === 'short') {
    if (input.isYongsanArea && isBeforeNoonInSeoul()) {
      return `${input.productName}는 현재 용산 수량이 부족해 이동 가능 여부 확인이 필요합니다. 담당자가 당일 가능 여부를 바로 확인하겠습니다.`;
    }

    if (input.isYongsanArea) {
      return `${input.productName}는 현재 용산 수량이 부족해 오늘은 일부 납품 또는 다음 배송 확인이 필요합니다. 담당자가 바로 확인하겠습니다.`;
    }

    return `${input.productName}는 요청 수량 기준으로 부족합니다. 담당자가 가능한 출고 방법을 바로 확인하겠습니다.`;
  }

  return `${input.productName}는 재고를 바로 확정하기 어려워 확인 후 다시 안내드리겠습니다.`;
}

function buildQuoteResponse(input: {
  productName: string;
  qty: number;
  unitPrice: number | null;
  totalAmount: number | null;
  inventoryStatus: 'available' | 'short' | 'check_needed';
  requiresHumanReview: boolean;
  prepaymentRequired: boolean;
}) {
  if (input.unitPrice === null) {
    return `${input.productName}는 단가를 바로 확정하기 어려워 담당자가 확인 후 견적을 안내드리겠습니다.`;
  }

  const parts = [
    `${input.productName} ${Number(input.qty)}개 기준 단가는 ${formatCurrency(input.unitPrice)}입니다.`
  ];

  if (input.totalAmount !== null) {
    parts.push(`예상 합계는 ${formatCurrency(input.totalAmount)}입니다.`);
  }

  if (input.inventoryStatus === 'available') {
    parts.push('현재 요청 수량 기준으로 진행 가능합니다.');
  } else if (input.inventoryStatus === 'short') {
    parts.push('다만 재고는 요청 수량 기준으로 부족하여 담당자 최종 확인이 필요합니다.');
  } else {
    parts.push('다만 재고는 추가 확인이 필요합니다.');
  }

  if (input.prepaymentRequired) {
    parts.push('먼저 선결제해주셔야 당일 출고 가능합니다.');
  }

  if (input.requiresHumanReview) {
    parts.push('담당자가 최종 확인 후 견적을 이어서 안내드리겠습니다.');
  }

  return parts.join(' ');
}

function formatCurrency(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function shortenForPhone(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 150 ? normalized : `${normalized.slice(0, 147)}...`;
}

function isBeforeNoonInSeoul(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    hour12: false
  });
  const hour = Number(formatter.format(now));
  return hour < 12;
}
