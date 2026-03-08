import type { FastifyInstance } from 'fastify';

import { env } from '../../config/env';
import {
  deliveryMethodLabels,
  getDeliveryRemark,
  parseDeliveryMethod,
  type DeliveryMethod
} from '../../lib/delivery';
import { createHttpError } from '../../lib/http';
import { normalizeDigits, normalizeWhitespace } from '../../lib/normalize';
import { searchTechKnowledge } from '../tech/service';

export type IntentType = 'order' | 'inventory' | 'quote' | 'tech' | 'other';
export type CustomerType = 'existing' | 'new';
export type HandoffTarget = 'sales' | 'tech' | 'none';
export type CustomerResolutionMode =
  | 'selected'
  | 'phone_exact'
  | 'name_exact'
  | 'phone_name_fuzzy'
  | 'candidate_only'
  | 'unresolved';
export type ProductResolutionMode =
  | 'selected'
  | 'item_exact'
  | 'model_exact'
  | 'compact_exact'
  | 'candidate_only'
  | 'unresolved';
export type ConversationStage =
  | 'opening'
  | 'customer'
  | 'product'
  | 'quantity'
  | 'delivery'
  | 'confirmation'
  | 'inventory'
  | 'quote'
  | 'tech'
  | 'handoff'
  | 'resolved';
export type NextAction =
  | 'confirm_customer'
  | 'ask_brand_or_product'
  | 'clarify_product'
  | 'ask_quantity'
  | 'ask_delivery'
  | 'confirm_order'
  | 'save_order'
  | 'save_quote'
  | 'check_inventory'
  | 'provide_quote'
  | 'provide_tech_guidance'
  | 'clarify_intent'
  | 'human_handoff';

export type ConversationState = {
  intentType?: IntentType;
  customerId?: string | undefined;
  customerConfirmed?: boolean;
  pendingCustomerId?: string | undefined;
  pendingCustomerName?: string | undefined;
  pendingProductId?: string | undefined;
  pendingProductCode?: string | undefined;
  pendingProductName?: string | undefined;
  orderConfirmed?: boolean;
  pendingConfirmation?: 'customer' | 'product' | 'order' | null;
  customerType?: CustomerType;
  brand?: string;
  productQuery?: string | undefined;
  productId?: string | undefined;
  productCode?: string | undefined;
  productName?: string | undefined;
  qty?: number;
  shippingMethod?: DeliveryMethod;
  warehouseCode?: '10' | '30';
  assistantRepeatCount?: number;
  repeatedQuestionCount?: number;
  elapsedSeconds?: number;
  repairCount?: number;
  customerCandidateCount?: number;
  productCandidateCount?: number;
  customerResolutionMode?: CustomerResolutionMode;
  productResolutionMode?: ProductResolutionMode;
  conversationStage?: ConversationStage;
  lastCustomerNameHint?: string | undefined;
  lastProductQuery?: string | undefined;
  lastSuggestedPrompt?: string | undefined;
};

export type AnalyzeTurnInput = {
  callSessionId?: string;
  callerNumber?: string;
  utterance: string;
  persistEvent?: boolean;
  hints?: {
    customerName?: string;
    brand?: string;
    productQuery?: string;
    qty?: number;
    shippingMethod?: string;
  };
  state?: ConversationState;
};

export type OrderPreviewInput = {
  callSessionId?: string;
  customerId?: string;
  customerType?: CustomerType;
  draftKind: 'sale' | 'quote';
  shippingMethod: string;
  warehouseCode?: '10' | '30';
  prepaymentNoticeSent?: boolean;
  lines: Array<{
    productId?: string;
    productCode?: string;
    qty: number;
    unitPrice?: number;
  }>;
};

type CustomerRow = {
  id: string;
  customer_code: string;
  customer_name: string;
  ceo_name: string | null;
  phone: string | null;
  mobile: string | null;
  address1: string | null;
  is_yongsan_area: boolean;
  deposit_required: boolean;
  deposit_note: string | null;
  score?: number;
};

type ProductCandidateRow = {
  id: string;
  brand: string;
  item_code: string;
  product_name: string;
  model_name: string | null;
  dealer_price: number | null;
  online_price: number | null;
  guide_price: number | null;
  is_lanstar: boolean;
  shipping_policy: string | null;
  score: number;
};

type ProductSelectionRow = {
  id: string;
  brand: string;
  item_code: string;
  product_name: string;
  model_name: string | null;
  dealer_price: number | null;
  online_price: number | null;
  guide_price: number | null;
  is_lanstar: boolean;
};

const explicitHandoffKeywords = ['사람', '상담원', '담당자', '직원', '연결'];
const angerKeywords = ['화나', '짜증', '불만', '왜 이래', '환불', '클레임', '욕', '장난', '답답'];
const techKeywords = [
  '고장',
  '불량',
  '안되',
  '안 돼',
  '드라이버',
  '설치',
  '설정',
  '호환',
  '초기화',
  '인식',
  '에러',
  '먹통'
];
const quoteKeywords = ['견적', '견적서', '단가', '가격', '얼마', '금액'];
const inventoryKeywords = ['재고', '남았', '있나요', '있을까요', '가능수량', '수량 있'];
const orderKeywords = ['주문', '발주', '출고', '발송', '보내', '납품', '접수'];
const affirmativeKeywords = ['네', '예', '맞', '맞아요', '맞습니다', '그렇', '응', '진행', '해주세요'];
const negativeResponseKeywords = ['아니', '아뇨', '틀려', '말고', '수정', '바꿔'];

const brandAliases: Array<{ brand: string; patterns: RegExp[] }> = [
  { brand: 'LANstar', patterns: [/lanstar/i, /랜스타/i] },
  { brand: 'ipTIME', patterns: [/ip[\s-]?time/i, /아이피타임/i] },
  { brand: 'NEXI', patterns: [/nexi/i, /넥시/i] },
  { brand: 'NEXT', patterns: [/\bnext\b/i, /넥스트/i] }
];

export async function analyzeTurn(
  app: FastifyInstance,
  input: AnalyzeTurnInput
) {
  const utterance = normalizeWhitespace(input.utterance) ?? '';
  const state = input.state ?? {};
  const confirmationSignal = detectConfirmationSignal(utterance);
  const customerConfirmed =
    state.pendingConfirmation === 'customer'
      ? confirmationSignal === 'yes'
        ? true
        : confirmationSignal === 'no'
          ? false
          : (state.customerConfirmed ?? false)
      : (state.customerConfirmed ?? false);
  const orderConfirmed =
    state.pendingConfirmation === 'order'
      ? confirmationSignal === 'yes'
        ? true
        : confirmationSignal === 'no'
          ? false
          : (state.orderConfirmed ?? false)
      : (state.orderConfirmed ?? false);
  const shippingMethod =
    parseDeliveryMethod(input.hints?.shippingMethod ?? '') ??
    state.shippingMethod ??
    detectShippingMethod(utterance);
  const qty = input.hints?.qty ?? state.qty ?? extractQty(utterance);
  const brand = normalizeWhitespace(input.hints?.brand) ?? state.brand ?? detectBrand(utterance);
  const customerNameHint =
    normalizeWhitespace(input.hints?.customerName) ??
    state.pendingCustomerName ??
    extractCustomerName(utterance);
  const productQuery =
    normalizeWhitespace(input.hints?.productQuery) ??
    state.productQuery ??
    extractProductQuery(utterance, brand, customerNameHint);

  const intent = classifyIntent(utterance, state.intentType);
  const customerLookupInput: {
    customerId?: string;
    callerNumber?: string;
    customerNameHint?: string;
  } = {};

  if (state.customerId) {
    customerLookupInput.customerId = state.customerId;
  }

  if (input.callerNumber) {
    customerLookupInput.callerNumber = input.callerNumber;
  }

  if (customerNameHint) {
    customerLookupInput.customerNameHint = customerNameHint;
  }

  const customerResolution = await resolveCustomer(app, customerLookupInput);
  let effectiveCustomer = customerResolution.resolved;

  if (
    state.pendingConfirmation === 'customer' &&
    confirmationSignal === 'yes' &&
    state.pendingCustomerId &&
    !effectiveCustomer
  ) {
    const confirmedCandidate =
      customerResolution.candidates.find((candidate) => candidate.id === state.pendingCustomerId) ??
      mapCustomerCandidate(await loadCustomerById(app, state.pendingCustomerId));

    effectiveCustomer = confirmedCandidate;
  }

  const customerType = inferCustomerType(effectiveCustomer, state.customerType);
  const productLookupInput: {
    productId?: string;
    productCode?: string;
    productQuery?: string;
    brand?: string;
    customerType: CustomerType;
  } = {
    customerType
  };

  if (state.productId) {
    productLookupInput.productId = state.productId;
  }

  if (state.productCode) {
    productLookupInput.productCode = state.productCode;
  }

  if (productQuery) {
    productLookupInput.productQuery = productQuery;
  }

  if (brand) {
    productLookupInput.brand = brand;
  }

  const productCandidates = await resolveProducts(app, productLookupInput);
  const productSelection = pickResolvedProduct({
    candidates: productCandidates,
    currentProductCode: state.productCode,
    productQuery
  });
  let resolvedProduct = productSelection.resolved;

  if (
    state.pendingConfirmation === 'product' &&
    confirmationSignal === 'yes' &&
    state.pendingProductId &&
    !resolvedProduct
  ) {
    const confirmedProduct = await loadDirectProduct(app, state.pendingProductId, state.pendingProductCode);

    if (confirmedProduct) {
      resolvedProduct = mapProductCandidate(confirmedProduct, customerType);
    }
  }
  const techCandidates =
    intent === 'tech' ? await searchTechCandidates(app, productQuery ?? utterance) : [];

  const handoffReasons = collectHandoffReasons({
    utterance,
    intent,
    state,
    techCandidatesFound: techCandidates.length > 0
  });
  const handoffRequired = handoffReasons.length > 0;
  const handoffTarget: HandoffTarget =
    handoffRequired ? (intent === 'tech' ? 'tech' : 'sales') : 'none';
  const nextAction = decideNextAction({
    intent,
    handoffRequired,
    customerResolved: Boolean(effectiveCustomer),
    customerCandidatesCount: customerResolution.candidates.length,
    customerConfirmed,
    productCandidatesCount: productCandidates.length,
    productCodeResolved: Boolean(resolvedProduct?.itemCode),
    qtyResolved: qty !== undefined,
    shippingResolved: shippingMethod !== null,
    orderConfirmed
  });
  const assistantPromptInput: Parameters<typeof buildAssistantPrompt>[0] = {
    nextAction,
    intent,
    customerCandidates: customerResolution.candidates,
    productCandidates,
    techCandidates,
    shippingMethod,
    confirmationSignal,
    pendingConfirmation: state.pendingConfirmation ?? null
  };

  if (effectiveCustomer?.customerName) {
    assistantPromptInput.resolvedCustomerName = effectiveCustomer.customerName;
  }

  if (qty !== undefined) {
    assistantPromptInput.qty = qty;
  }

  const assistantPrompt = buildAssistantPrompt(assistantPromptInput);
  const customerResolutionMode = customerResolution.resolutionMode;
  const productResolutionMode = resolvedProduct
    ? productSelection.resolutionMode
    : productCandidates.length > 0
      ? 'candidate_only'
      : 'unresolved';
  const nextRepairCount = shouldIncreaseRepairCount({
    nextAction,
    state,
    customerCandidatesCount: customerResolution.candidates.length,
    productCandidatesCount: productCandidates.length,
    confirmationSignal
  })
    ? (state.repairCount ?? 0) + 1
    : (state.repairCount ?? 0);

  const statePatch: ConversationState = {};
  statePatch.intentType = intent;
  statePatch.customerType = customerType;
  statePatch.customerConfirmed = customerConfirmed;
  statePatch.orderConfirmed = orderConfirmed;
  statePatch.customerCandidateCount = customerResolution.candidates.length;
  statePatch.productCandidateCount = productCandidates.length;
  statePatch.customerResolutionMode = customerResolutionMode;
  statePatch.productResolutionMode = productResolutionMode;
  statePatch.lastCustomerNameHint = customerNameHint;
  statePatch.lastProductQuery = productQuery;
  statePatch.lastSuggestedPrompt = assistantPrompt;
  statePatch.conversationStage = mapNextActionToStage(nextAction, intent);
  statePatch.repairCount = nextRepairCount;

  if (state.pendingConfirmation === 'customer' && confirmationSignal === 'no') {
    statePatch.customerId = undefined;
    statePatch.pendingCustomerId = undefined;
    statePatch.pendingCustomerName = undefined;
  }

  if (state.pendingConfirmation === 'product' && confirmationSignal === 'no') {
    statePatch.productId = undefined;
    statePatch.productCode = undefined;
    statePatch.productName = undefined;
    statePatch.pendingProductId = undefined;
    statePatch.pendingProductCode = undefined;
    statePatch.pendingProductName = undefined;
  }

  if (
    state.pendingConfirmation === 'customer' &&
    confirmationSignal === 'yes' &&
    state.pendingCustomerId
  ) {
    statePatch.customerId = state.pendingCustomerId;
    statePatch.customerConfirmed = true;
  }

  if (effectiveCustomer && !(state.pendingConfirmation === 'customer' && confirmationSignal === 'no')) {
    statePatch.customerId = effectiveCustomer.id;
  }

  if (resolvedProduct && !(state.pendingConfirmation === 'product' && confirmationSignal === 'no')) {
    statePatch.productId = resolvedProduct.id;
    statePatch.productCode = resolvedProduct.itemCode;
    statePatch.productName = resolvedProduct.productName;
  }

  if (brand) {
    statePatch.brand = brand;
  }

  if (productQuery) {
    statePatch.productQuery = productQuery;
  }

  if (qty !== undefined) {
    statePatch.qty = qty;
  }

  if (shippingMethod) {
    statePatch.shippingMethod = shippingMethod;
  }

  if (nextAction === 'confirm_customer') {
    const pendingCustomer = customerResolution.resolved ?? customerResolution.candidates[0] ?? null;
    statePatch.pendingCustomerId = pendingCustomer?.id;
    statePatch.pendingCustomerName = pendingCustomer?.customerName;
  } else {
    statePatch.pendingCustomerId = undefined;
    statePatch.pendingCustomerName = undefined;
  }

  if (nextAction === 'clarify_product') {
    const pendingProduct = productCandidates[0] ?? null;
    statePatch.pendingProductId = pendingProduct?.id;
    statePatch.pendingProductCode = pendingProduct?.itemCode;
    statePatch.pendingProductName = pendingProduct?.productName;
  } else {
    statePatch.pendingProductId = undefined;
    statePatch.pendingProductCode = undefined;
    statePatch.pendingProductName = undefined;
  }

  statePatch.pendingConfirmation =
    nextAction === 'confirm_customer'
      ? 'customer'
      : nextAction === 'clarify_product'
        ? 'product'
      : nextAction === 'confirm_order'
        ? 'order'
        : null;

  const response = {
    intent,
    confidence: calculateConfidence({
      intent,
      customerResolved: Boolean(customerResolution.resolved),
      productCandidatesCount: productCandidates.length,
      techCandidatesCount: techCandidates.length,
      handoffRequired
    }),
    nextAction,
    handoffRequired,
    handoffTarget,
    handoffReasons,
    assistantPrompt,
    extracted: {
      customerNameHint,
      brand,
      productQuery,
      qty,
      shippingMethod,
      shippingMethodLabel: shippingMethod ? deliveryMethodLabels[shippingMethod] : null
    },
    quality: {
      customerResolutionMode,
      productResolutionMode,
      customerCandidatesCount: customerResolution.candidates.length,
      productCandidatesCount: productCandidates.length,
      repairCount: nextRepairCount,
      conversationStage: statePatch.conversationStage
    },
    customer: effectiveCustomer,
    customerCandidates: customerResolution.candidates,
    productCandidates,
    techCandidates,
    statePatch
  };

  if (input.callSessionId) {
    const syncInput: {
      intent: IntentType;
      customerId?: string;
      handoffRequired: boolean;
      handoffTarget: HandoffTarget;
    } = {
      intent,
      handoffRequired,
      handoffTarget
    };

    if (effectiveCustomer?.id) {
      syncInput.customerId = effectiveCustomer.id;
    }

    await syncCallSession(app, input.callSessionId, syncInput);

    if (input.persistEvent !== false) {
      await appendSystemEvent(app, input.callSessionId, {
        type: 'turn_analysis',
        intent,
        nextAction,
        handoffRequired,
        handoffTarget,
        handoffReasons,
        extracted: response.extracted
      });
    }
  }

  return response;
}

export async function buildOrderPreview(
  app: FastifyInstance,
  input: OrderPreviewInput
) {
  const shippingMethod = parseDeliveryMethod(input.shippingMethod);

  if (!shippingMethod) {
    throw createHttpError(400, 'Unsupported shipping method');
  }

  const customer = input.customerId ? await loadCustomerById(app, input.customerId) : null;
  const customerType =
    input.customerType ?? (customer ? 'existing' : 'new');
  const warehouseCode = input.warehouseCode ?? '10';
  const lineResults = [];
  const humanReviewReasons = new Set<string>();

  for (const line of input.lines) {
    const product = await loadProductSelection(app, line.productId, line.productCode);
    const pricing = choosePrice(product, customerType, line.unitPrice);
    const inventory = await lookupInventory(app, product.item_code, warehouseCode, line.qty);

    if (inventory.status !== 'available') {
      humanReviewReasons.add(
        inventory.status === 'short' ? 'inventory_short' : 'inventory_check_needed'
      );
    }

    if (pricing.unitPrice === null) {
      humanReviewReasons.add('price_missing');
    }

    const supplyAmount =
      pricing.unitPrice !== null
        ? Number((pricing.unitPrice * line.qty).toFixed(2))
        : null;
    const vatAmount =
      supplyAmount !== null ? Number((supplyAmount * 0.1).toFixed(2)) : null;
    const totalAmount =
      supplyAmount !== null && vatAmount !== null ? supplyAmount + vatAmount : null;
    const notes = buildPreviewLineNotes(inventory);

    lineResults.push({
      productId: product.id,
      productCode: product.item_code,
      productName: product.product_name,
      brand: product.brand,
      matchedModelName: product.model_name,
      qty: line.qty,
      unitPrice: pricing.unitPrice,
      supplyAmount,
      vatAmount,
      totalAmount,
      pricePolicy: pricing.pricePolicy,
      inventoryStatus: inventory.status,
      matchConfidence: 1,
      notes,
      availableQty: inventory.availableQty
    });
  }

  const totalSupplyAmount = lineResults.reduce(
    (sum, line) => sum + (line.supplyAmount ?? 0),
    0
  );
  const totalVatAmount = lineResults.reduce((sum, line) => sum + (line.vatAmount ?? 0), 0);
  const totalAmount = lineResults.reduce((sum, line) => sum + (line.totalAmount ?? 0), 0);

  if (totalSupplyAmount >= 10_000_000) {
    humanReviewReasons.add('high_value_order');
  }

  if (!customer && input.draftKind === 'sale') {
    humanReviewReasons.add('customer_code_required');
  }

  const requiresHumanReview = humanReviewReasons.size > 0;
  const draftPayload = {
    callSessionId: input.callSessionId,
    customerId: customer?.id,
    draftKind: input.draftKind,
    warehouseCode,
    shippingMethod: deliveryMethodLabels[shippingMethod],
    remarkText: getDeliveryRemark(shippingMethod),
    prepaymentRequired: customer?.deposit_required ?? false,
    prepaymentNoticeSent: input.prepaymentNoticeSent ?? false,
    requiresHumanReview,
    humanReviewReason: requiresHumanReview
      ? Array.from(humanReviewReasons).join(', ')
      : undefined,
    lines: lineResults.map((line) => ({
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      brand: line.brand,
      matchedModelName: line.matchedModelName ?? undefined,
      qty: line.qty,
      unitPrice: line.unitPrice ?? undefined,
      supplyAmount: line.supplyAmount ?? undefined,
      vatAmount: line.vatAmount ?? undefined,
      totalAmount: line.totalAmount ?? undefined,
      pricePolicy: line.pricePolicy,
      inventoryStatus: line.inventoryStatus,
      matchConfidence: line.matchConfidence,
      notes: line.notes ?? undefined
    }))
  };

  if (input.callSessionId) {
    await appendSystemEvent(app, input.callSessionId, {
      type: 'order_preview',
      draftKind: input.draftKind,
      warehouseCode,
      shippingMethod,
      requiresHumanReview,
      humanReviewReasons: Array.from(humanReviewReasons)
    });
  }

  return {
    customer: customer
      ? {
          id: customer.id,
          customerCode: customer.customer_code,
          customerName: customer.customer_name,
          depositRequired: customer.deposit_required,
          depositNote: customer.deposit_note,
          isYongsanArea: customer.is_yongsan_area
        }
      : null,
    customerType,
    warehouseCode,
    shippingMethod,
    shippingMethodLabel: deliveryMethodLabels[shippingMethod],
    prepaymentRequired: customer?.deposit_required ?? false,
    requiresHumanReview,
    humanReviewReasons: Array.from(humanReviewReasons),
    totalSupplyAmount,
    totalVatAmount,
    totalAmount,
    lines: lineResults,
    draftPayload
  };
}

async function resolveCustomer(
  app: FastifyInstance,
  input: {
    customerId?: string;
    callerNumber?: string;
    customerNameHint?: string;
  }
) {
  if (input.customerId) {
    const customer = await loadCustomerById(app, input.customerId);

    return {
      resolved: mapCustomerCandidate(customer),
      candidates: [mapCustomerCandidate(customer)],
      resolutionMode: 'selected' as CustomerResolutionMode
    };
  }

  const phoneDigits = normalizeDigits(input.callerNumber);
  const nameHint = normalizeWhitespace(input.customerNameHint);
  const normalizedNameHint = normalizeCustomerNameHint(nameHint);

  if (!phoneDigits && !nameHint && !normalizedNameHint) {
    return {
      resolved: null,
      candidates: [],
      resolutionMode: 'unresolved' as CustomerResolutionMode
    };
  }

  const nameLike = nameHint ? `%${nameHint}%` : null;
  const result = await app.db.query<CustomerRow>(
    `
      select
        id,
        customer_code,
        customer_name,
        ceo_name,
        phone,
        mobile,
        address1,
        is_yongsan_area,
        deposit_required,
        deposit_note,
        (
          case
            when $1::text is not null and (phone_digits = $1 or mobile_digits = $1) then 100
            when $1::text is not null and (phone_digits like '%' || $1 || '%' or mobile_digits like '%' || $1 || '%') then 80
            else 0
          end
          +
          case
            when $2::text is not null and customer_name ilike $3 then 40
            else 0
          end
          +
          case
            when $4::text is not null and coalesce(customer_name_normalized, '') = $4 then 70
            else 0
          end
          +
          case
            when $2::text is not null then greatest(
              similarity(customer_name, $2) * 20,
              similarity(coalesce(customer_name_normalized, ''), coalesce($4, '')) * 35
            )
            else 0
          end
        ) as score
      from aicc.master_customer
      where
        ($1::text is not null and (phone_digits like '%' || $1 || '%' or mobile_digits like '%' || $1 || '%'))
        or
        (
          $2::text is not null and (
            customer_name ilike $3
            or coalesce(customer_name_normalized, '') ilike '%' || coalesce($4, '') || '%'
            or similarity(customer_name, $2) >= 0.2
            or similarity(coalesce(customer_name_normalized, ''), coalesce($4, '')) >= 0.2
          )
        )
      order by score desc, customer_name asc
      limit 5
    `,
    [phoneDigits, nameHint, nameLike, normalizedNameHint]
  );

  const candidates = result.rows.map(mapCustomerCandidate);
  const top = result.rows[0];
  const second = result.rows[1];
  const topPhoneExact =
    top &&
    phoneDigits !== null &&
    ((top.phone ? normalizeDigits(top.phone) === phoneDigits : false) ||
      (top.mobile ? normalizeDigits(top.mobile) === phoneDigits : false));
  const topNameExact =
    top && normalizedNameHint !== null && normalizeCustomerNameHint(top.customer_name) === normalizedNameHint;
  const resolved =
    top &&
    ((topPhoneExact && (!second || (top.score ?? 0) - (second.score ?? 0) >= 10)) ||
      (topNameExact && (!second || (top.score ?? 0) - (second.score ?? 0) >= 15)))
      ? mapCustomerCandidate(top)
      : null;
  const resolutionMode: CustomerResolutionMode = resolved
    ? topPhoneExact && topNameExact
      ? 'phone_name_fuzzy'
      : topPhoneExact
        ? 'phone_exact'
        : topNameExact
          ? 'name_exact'
          : 'phone_name_fuzzy'
    : candidates.length > 0
      ? 'candidate_only'
      : 'unresolved';

  return {
    resolved,
    candidates,
    resolutionMode
  };
}

async function resolveProducts(
  app: FastifyInstance,
  input: {
    productId?: string;
    productCode?: string;
    productQuery?: string;
    brand?: string;
    customerType: CustomerType;
  }
) {
  const directProduct = await loadDirectProduct(app, input.productId, input.productCode);

  if (directProduct) {
    return [mapProductCandidate(directProduct, input.customerType)];
  }

  const productQuery = normalizeWhitespace(input.productQuery);

  if (!productQuery || productQuery.length < 2) {
    return [];
  }

  const brand = normalizeWhitespace(input.brand);
  const brandLike = brand ? `%${brand}%` : null;
  const qLike = `%${productQuery}%`;
  const exactLookupToken = normalizeLookupToken(productQuery);
  const compactLookupToken = normalizeCompactLookupToken(productQuery);
  const preferLanstar = !brand || brand.toLowerCase() === 'lanstar';
  const result = await app.db.query<ProductCandidateRow>(
    `
      select
        mp.id,
        mp.brand,
        mp.item_code,
        mp.product_name,
        mp.model_name,
        mp.dealer_price,
        mp.online_price,
        mp.guide_price,
        mp.is_lanstar,
        mp.shipping_policy,
        (
          case
            when $2::boolean is true and mp.is_lanstar then 25
            else 0
          end
          +
          case
            when $6::text is not null and upper(regexp_replace(mp.item_code, '\s+', '', 'g')) = $6 then 130
            when $6::text is not null and upper(regexp_replace(coalesce(mp.model_name, ''), '\s+', '', 'g')) = $6 then 120
            else 0
          end
          +
          case
            when $7::text is not null and regexp_replace(upper(mp.item_code), '[^A-Z0-9]', '', 'g') = $7 then 115
            when $7::text is not null and regexp_replace(upper(coalesce(mp.model_name, '')), '[^A-Z0-9]', '', 'g') = $7 then 105
            else 0
          end
          +
          case
            when $3::text is not null and mp.brand ilike $4 then 15
            else 0
          end
          +
          case
            when mp.product_name ilike $5 then 20
            else 0
          end
          +
          case
            when coalesce(mp.model_name, '') ilike $5 then 20
            else 0
          end
          +
          coalesce(alias.alias_score, 0) * 25
          +
          similarity(mp.search_text, $1) * 20
        ) as score
      from aicc.master_product mp
      left join lateral (
        select max(similarity(pa.alias_text, $1)) as alias_score
        from aicc.product_alias pa
        where pa.product_id = mp.id
      ) alias on true
      where
        mp.is_active = true
        and ($3::text is null or mp.brand ilike $4)
        and (
          ($6::text is not null and (
            upper(regexp_replace(mp.item_code, '\s+', '', 'g')) = $6
            or upper(regexp_replace(coalesce(mp.model_name, ''), '\s+', '', 'g')) = $6
          ))
          or
          ($7::text is not null and (
            regexp_replace(upper(mp.item_code), '[^A-Z0-9]', '', 'g') = $7
            or regexp_replace(upper(coalesce(mp.model_name, '')), '[^A-Z0-9]', '', 'g') = $7
          ))
          or
          mp.search_text ilike $5
          or mp.product_name ilike $5
          or coalesce(mp.model_name, '') ilike $5
          or exists (
            select 1
            from aicc.product_alias pa
            where pa.product_id = mp.id
              and (
                pa.alias_text ilike $5
                or ($7::text is not null and regexp_replace(upper(pa.alias_text), '[^A-Z0-9]', '', 'g') = $7)
              )
          )
        )
      order by score desc, mp.is_lanstar desc, mp.guide_price nulls last, mp.product_name asc
      limit 5
    `,
    [productQuery, preferLanstar, brand, brandLike, qLike, exactLookupToken, compactLookupToken]
  );

  return result.rows.map((row) => mapProductCandidate(row, input.customerType));
}

async function searchTechCandidates(app: FastifyInstance, rawQuery: string) {
  const candidates = await searchTechKnowledge(app, rawQuery, 3);

  return candidates.map((candidate) => ({
    chunkId: candidate.chunkId,
    modelId: candidate.modelId,
    brand: candidate.brand,
    modelName: candidate.modelName,
    productName: candidate.productName,
    category: candidate.category,
    answerSnippet: candidate.answerSnippet,
    score: candidate.score
  }));
}

async function loadCustomerById(app: FastifyInstance, customerId: string) {
  const result = await app.db.query<CustomerRow>(
    `
      select
        id,
        customer_code,
        customer_name,
        ceo_name,
        phone,
        mobile,
        address1,
        is_yongsan_area,
        deposit_required,
        deposit_note
      from aicc.master_customer
      where id = $1
    `,
    [customerId]
  );

  const customer = result.rows[0];

  if (!customer) {
    throw createHttpError(404, 'Customer not found');
  }

  return customer;
}

async function loadDirectProduct(
  app: FastifyInstance,
  productId?: string,
  productCode?: string
) {
  if (!productId && !productCode) {
    return null;
  }

  const result = await app.db.query<ProductSelectionRow>(
    `
      select
        id,
        brand,
        item_code,
        product_name,
        model_name,
        dealer_price,
        online_price,
        guide_price,
        is_lanstar
      from aicc.master_product
      where
        ($1::uuid is not null and id = $1)
        or
        ($2::text is not null and item_code = $2)
      order by is_lanstar desc, created_at desc
      limit 1
    `,
    [productId ?? null, productCode ?? null]
  );

  return result.rows[0] ?? null;
}

async function loadProductSelection(
  app: FastifyInstance,
  productId?: string,
  productCode?: string
) {
  const product = await loadDirectProduct(app, productId, productCode);

  if (!product) {
    throw createHttpError(404, 'Product not found');
  }

  return product;
}

async function lookupInventory(
  app: FastifyInstance,
  productCode: string,
  warehouseCode: string,
  requestedQty: number
) {
  try {
    const items = await app.ecount.getInventoryByLocation({
      productCode,
      warehouseCode
    });
    const availableQty = items.reduce(
      (sum, item) => sum + (item.balanceQuantity ?? 0),
      0
    );
    const status =
      items.length === 0
        ? 'check_needed'
        : availableQty >= requestedQty
          ? 'available'
          : availableQty > 0
            ? 'short'
            : 'check_needed';

    return {
      status,
      availableQty: Number(availableQty.toFixed(3))
    } as const;
  } catch {
    return {
      status: 'check_needed',
      availableQty: null
    } as const;
  }
}

function choosePrice(
  product: ProductSelectionRow,
  customerType: CustomerType,
  manualUnitPrice?: number
) {
  if (manualUnitPrice !== undefined) {
    return {
      unitPrice: manualUnitPrice,
      pricePolicy: 'manual' as const
    };
  }

  if (product.is_lanstar && customerType === 'existing' && product.dealer_price !== null) {
    return {
      unitPrice: product.dealer_price,
      pricePolicy: 'out_price1' as const
    };
  }

  if (product.is_lanstar && customerType === 'new' && product.online_price !== null) {
    return {
      unitPrice: product.online_price,
      pricePolicy: 'out_price2' as const
    };
  }

  if (product.guide_price !== null) {
    return {
      unitPrice: product.guide_price,
      pricePolicy: 'guide_price' as const
    };
  }

  if (product.online_price !== null) {
    return {
      unitPrice: product.online_price,
      pricePolicy: product.is_lanstar ? ('out_price2' as const) : ('guide_price' as const)
    };
  }

  if (product.dealer_price !== null) {
    return {
      unitPrice: product.dealer_price,
      pricePolicy: product.is_lanstar ? ('out_price1' as const) : ('guide_price' as const)
    };
  }

  return {
    unitPrice: null,
    pricePolicy: 'manual' as const
  };
}

function buildPreviewLineNotes(inventory: {
  status: 'available' | 'short' | 'check_needed';
  availableQty: number | null;
}) {
  if (inventory.availableQty === null) {
    return 'ERP 재고조회 확인 필요';
  }

  if (inventory.status === 'short') {
    return `확보수량 ${inventory.availableQty}`;
  }

  return inventory.status === 'available'
    ? `재고 가능 ${inventory.availableQty}`
    : '재고 확인 필요';
}

function mapCustomerCandidate(row: CustomerRow) {
  return {
    id: row.id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    phone: row.phone,
    mobile: row.mobile,
    address1: row.address1,
    isYongsanArea: row.is_yongsan_area,
    depositRequired: row.deposit_required,
    depositNote: row.deposit_note,
    score: row.score !== undefined ? Number(row.score.toFixed(2)) : null
  };
}

function mapProductCandidate(
  row: ProductCandidateRow | ProductSelectionRow,
  customerType: CustomerType
) {
  const recommended =
    row.is_lanstar && customerType === 'existing'
      ? row.dealer_price ?? row.guide_price ?? row.online_price
      : row.is_lanstar && customerType === 'new'
        ? row.online_price ?? row.guide_price ?? row.dealer_price
        : row.guide_price ?? row.online_price ?? row.dealer_price;
  const pricePolicy =
    row.is_lanstar && customerType === 'existing' && row.dealer_price !== null
      ? 'out_price1'
      : row.is_lanstar && customerType === 'new' && row.online_price !== null
        ? 'out_price2'
        : recommended !== null
          ? 'guide_price'
          : 'manual';

  return {
    id: row.id,
    brand: row.brand,
    itemCode: row.item_code,
    productName: row.product_name,
    modelName: row.model_name,
    recommendedPrice: recommended,
    pricePolicy,
    score: 'score' in row ? Number(row.score.toFixed(2)) : 100
  };
}

function inferCustomerType(
  customer: ReturnType<typeof mapCustomerCandidate> | null,
  currentType?: CustomerType
): CustomerType {
  if (customer) {
    return 'existing';
  }

  return currentType ?? 'new';
}

function classifyIntent(utterance: string, currentIntent?: IntentType): IntentType {
  const text = utterance.toLowerCase();
  const scores: Record<IntentType, number> = {
    order: 0,
    inventory: 0,
    quote: 0,
    tech: 0,
    other: 0
  };

  scores.tech += countKeywordMatches(text, techKeywords) * 3;
  scores.quote += countKeywordMatches(text, quoteKeywords) * 3;
  scores.inventory += countKeywordMatches(text, inventoryKeywords) * 3;
  scores.order += countKeywordMatches(text, orderKeywords) * 3;

  if (scores.quote > 0 && /견적서/.test(text)) {
    scores.quote += 2;
  }

  if (scores.order > 0 && /오늘|당일|발송|출고/.test(text)) {
    scores.order += 1;
  }

  if (currentIntent && scores[currentIntent] > 0) {
    scores[currentIntent] += 1;
  }

  const sorted = (Object.entries(scores) as Array<[IntentType, number]>).sort(
    (a, b) => b[1] - a[1]
  );

  const best = sorted[0];

  if (!best) {
    return currentIntent ?? 'other';
  }

  return best[1] > 0 ? best[0] : currentIntent ?? 'other';
}

function decideNextAction(input: {
  intent: IntentType;
  handoffRequired: boolean;
  customerResolved: boolean;
  customerCandidatesCount: number;
  customerConfirmed: boolean;
  productCandidatesCount: number;
  productCodeResolved: boolean;
  qtyResolved: boolean;
  shippingResolved: boolean;
  orderConfirmed: boolean;
}): NextAction {
  if (input.handoffRequired) {
    return 'human_handoff';
  }

  if (input.intent === 'order') {
    if (!input.customerResolved && input.customerCandidatesCount > 0) {
      return 'confirm_customer';
    }

    if (input.customerResolved && !input.customerConfirmed) {
      return 'confirm_customer';
    }

    if (!input.productCodeResolved && input.productCandidatesCount === 0) {
      return 'ask_brand_or_product';
    }

    if (!input.productCodeResolved && input.productCandidatesCount >= 1) {
      return 'clarify_product';
    }

    if (!input.qtyResolved) {
      return 'ask_quantity';
    }

    if (!input.shippingResolved) {
      return 'ask_delivery';
    }

    if (input.orderConfirmed) {
      return 'save_order';
    }

    return 'confirm_order';
  }

  if (input.intent === 'inventory') {
    if (!input.productCodeResolved && input.productCandidatesCount === 0) {
      return 'ask_brand_or_product';
    }

    if (!input.productCodeResolved && input.productCandidatesCount >= 1) {
      return 'clarify_product';
    }

    return 'check_inventory';
  }

  if (input.intent === 'quote') {
    if (!input.customerResolved && input.customerCandidatesCount > 0) {
      return 'confirm_customer';
    }

    if (!input.productCodeResolved && input.productCandidatesCount === 0) {
      return 'ask_brand_or_product';
    }

    if (!input.productCodeResolved && input.productCandidatesCount >= 1) {
      return 'clarify_product';
    }

    if (!input.qtyResolved) {
      return 'ask_quantity';
    }

    if (input.orderConfirmed) {
      return 'save_quote';
    }

    return 'provide_quote';
  }

  if (input.intent === 'tech') {
    return input.productCandidatesCount > 0 || input.productCodeResolved
      ? 'provide_tech_guidance'
      : 'ask_brand_or_product';
  }

  return 'clarify_intent';
}

function buildAssistantPrompt(input: {
  nextAction: NextAction;
  intent: IntentType;
  resolvedCustomerName?: string;
  customerCandidates: Array<ReturnType<typeof mapCustomerCandidate>>;
  productCandidates: Array<ReturnType<typeof mapProductCandidate>>;
  techCandidates: Array<{
    answerSnippet: string;
    productName: string;
  }>;
  qty?: number;
  shippingMethod: DeliveryMethod | null;
  confirmationSignal: 'yes' | 'no' | 'unknown';
  pendingConfirmation: 'customer' | 'product' | 'order' | null;
}) {
  if (input.pendingConfirmation === 'customer' && input.confirmationSignal === 'no') {
    return '정확한 거래처명과 전화번호 뒷자리 네 자리를 다시 말씀해 주세요.';
  }

  if (input.pendingConfirmation === 'product' && input.confirmationSignal === 'no') {
    return '모델명이나 품명을 다시 확인하겠습니다. 모델명이 있으면 먼저 말씀해 주시고, 없으면 제조사와 품명, 규격을 천천히 말씀해 주세요.';
  }

  if (input.pendingConfirmation === 'order' && input.confirmationSignal === 'no') {
    return '수정하실 내용을 말씀해 주세요. 품명, 수량, 배송방식 중 어떤 부분인지 다시 확인하겠습니다.';
  }

  switch (input.nextAction) {
    case 'confirm_customer':
      if (input.customerCandidates.length > 1) {
        return `확인된 거래처 후보는 ${formatCustomerCandidates(input.customerCandidates)} 입니다. 어느 거래처인지 말씀해 주시거나 전화번호 뒷자리 네 자리를 다시 말씀해 주세요.`;
      }

      return `${input.resolvedCustomerName ?? input.customerCandidates[0]?.customerName ?? '거래처명'} 맞으실까요? 아니시면 거래처명과 전화번호 뒷자리 네 자리를 다시 말씀해 주세요.`;
    case 'ask_brand_or_product':
      return '모델명이 있으면 모델명을 먼저 말씀해 주세요. 없으면 제조사, 품명, 규격 중 한 가지부터 천천히 말씀해 주세요.';
    case 'clarify_product':
      if (input.productCandidates.length === 1) {
        const candidate = input.productCandidates[0];

        if (!candidate) {
          return '모델명이 있으면 모델명을 먼저 말씀해 주세요. 없으면 제조사와 품명을 다시 말씀해 주세요.';
        }

        return `확인하겠습니다. ${formatProductCandidate(candidate)} 맞으실까요?`;
      }

      return `확인된 품목 후보는 ${input.productCandidates
        .slice(0, 2)
        .map(formatProductCandidate)
        .join(', ')} 입니다. 어느 제품인지 말씀해 주세요.`;
    case 'ask_quantity':
      return '수량을 개수 기준으로 말씀해 주세요.';
    case 'ask_delivery':
      return '배송, 방문수령, 택배, 퀵 중 어떤 방식으로 진행할까요?';
    case 'confirm_order': {
      const leadProduct = input.productCandidates[0];
      const parts = [];

      if (input.resolvedCustomerName) {
        parts.push(input.resolvedCustomerName);
      }

      if (leadProduct) {
        parts.push(
          formatProductCandidate(leadProduct)
        );
      }

      if (input.qty !== undefined) {
        parts.push(`${input.qty}개`);
      }

      if (input.shippingMethod) {
        parts.push(deliveryMethodLabels[input.shippingMethod]);
      }

      return `확인하겠습니다. ${parts.join(' ')} 맞으실까요?`;
    }
    case 'save_order':
      return '확인된 내용으로 주문 접수를 진행하겠습니다.';
    case 'save_quote':
      return '확인된 내용으로 견적 등록을 진행하겠습니다.';
    case 'check_inventory':
      return '해당 품목 기준으로 재고를 확인해보겠습니다.';
    case 'provide_quote':
      return '확인된 품목 기준으로 견적 가능 여부와 단가를 정리해드리겠습니다.';
    case 'provide_tech_guidance':
      return input.techCandidates[0]?.answerSnippet ?? '확인된 자료 기준으로 점검 순서를 안내드리겠습니다.';
    case 'human_handoff':
      return input.intent === 'tech'
        ? '기술 담당자가 바로 이어서 확인하겠습니다.'
        : '영업 담당자가 바로 이어서 확인하겠습니다.';
    default:
      return '주문, 재고, 견적, 기술문의 중 어떤 내용인지 말씀해 주세요.';
  }
}

function collectHandoffReasons(input: {
  utterance: string;
  intent: IntentType;
  state: ConversationState;
  techCandidatesFound: boolean;
}) {
  const reasons: string[] = [];
  const lower = input.utterance.toLowerCase();

  if (containsAnyKeyword(lower, explicitHandoffKeywords)) {
    reasons.push('explicit_handoff_requested');
  }

  if (containsAnyKeyword(lower, angerKeywords)) {
    reasons.push('anger_detected');
  }

  if ((input.state.repeatedQuestionCount ?? 0) >= 2) {
    reasons.push('repeat_loop');
  }

  if ((input.state.elapsedSeconds ?? 0) >= 90) {
    reasons.push('long_call');
  }

  if ((input.state.assistantRepeatCount ?? 0) >= 2) {
    reasons.push('assistant_loop');
  }

  if (input.intent === 'tech' && !input.techCandidatesFound) {
    reasons.push('tech_kb_not_found');
  }

  return reasons;
}

function calculateConfidence(input: {
  intent: IntentType;
  customerResolved: boolean;
  productCandidatesCount: number;
  techCandidatesCount: number;
  handoffRequired: boolean;
}) {
  let score = input.intent === 'other' ? 0.35 : 0.6;

  if (input.customerResolved) {
    score += 0.1;
  }

  if (input.productCandidatesCount > 0) {
    score += 0.15;
  }

  if (input.techCandidatesCount > 0) {
    score += 0.15;
  }

  if (input.handoffRequired) {
    score -= 0.2;
  }

  return Number(Math.max(0, Math.min(0.99, score)).toFixed(2));
}

function shouldIncreaseRepairCount(input: {
  nextAction: NextAction;
  state: ConversationState;
  customerCandidatesCount: number;
  productCandidatesCount: number;
  confirmationSignal: 'yes' | 'no' | 'unknown';
}) {
  if (input.confirmationSignal === 'no') {
    return true;
  }

  if (input.nextAction === 'confirm_customer' && input.customerCandidatesCount > 0) {
    return true;
  }

  if (input.nextAction === 'clarify_product' && input.productCandidatesCount > 0) {
    return true;
  }

  if (
    input.nextAction === 'ask_brand_or_product' &&
    (input.state.productCandidateCount ?? 0) === 0 &&
    Boolean(input.state.lastProductQuery)
  ) {
    return true;
  }

  return false;
}

function mapNextActionToStage(nextAction: NextAction, intent: IntentType): ConversationStage {
  switch (nextAction) {
    case 'confirm_customer':
      return 'customer';
    case 'ask_brand_or_product':
    case 'clarify_product':
      return 'product';
    case 'ask_quantity':
      return 'quantity';
    case 'ask_delivery':
      return 'delivery';
    case 'confirm_order':
      return 'confirmation';
    case 'check_inventory':
      return 'inventory';
    case 'provide_quote':
    case 'save_quote':
      return 'quote';
    case 'provide_tech_guidance':
      return 'tech';
    case 'human_handoff':
      return 'handoff';
    case 'save_order':
      return 'resolved';
    default:
      return intent === 'other' ? 'opening' : 'product';
  }
}

function formatCustomerCandidates(candidates: Array<ReturnType<typeof mapCustomerCandidate>>) {
  return candidates
    .slice(0, 2)
    .map((candidate) => candidate.customerName)
    .join(', ');
}

function formatProductCandidate(candidate: ReturnType<typeof mapProductCandidate>) {
  if (candidate.modelName) {
    return `${candidate.productName} ${candidate.modelName}`;
  }

  return `${candidate.productName} ${candidate.itemCode}`;
}

function detectShippingMethod(utterance: string): DeliveryMethod | null {
  if (/경동화물|지점\s*수령/.test(utterance)) {
    return 'courier_kd_freight';
  }

  if (/캐비넷|경동택배/.test(utterance)) {
    return 'courier_kd_parcel';
  }

  if (/퀵/.test(utterance)) {
    return 'quick';
  }

  if (/방문\s*수령|찾으러/.test(utterance)) {
    return 'pickup';
  }

  if (/택배/.test(utterance)) {
    return 'courier_rogen';
  }

  if (/배송/.test(utterance)) {
    return 'delivery';
  }

  return null;
}

function detectBrand(utterance: string) {
  for (const candidate of brandAliases) {
    if (candidate.patterns.some((pattern) => pattern.test(utterance))) {
      return candidate.brand;
    }
  }

  return undefined;
}

function extractQty(utterance: string) {
  const match = utterance.match(/(\d+(?:\.\d+)?)\s*(개|ea|EA|박스|box|BOX|세트|set|SET)\b/);

  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

function extractProductQuery(
  utterance: string,
  brand?: string,
  customerNameHint?: string
) {
  let value = utterance;
  value = value.replace(/\d+(?:\.\d+)?\s*(개|ea|EA|박스|box|BOX|세트|set|SET)\b/g, ' ');
  value = value.replace(/주문|발주|출고|발송|재고|견적서|견적|가격|단가|배송|택배|방문수령|퀵/g, ' ');

  if (brand) {
    value = value.replace(new RegExp(escapeRegExp(brand), 'ig'), ' ');
  }

  if (customerNameHint) {
    value = value.replace(new RegExp(escapeRegExp(customerNameHint), 'ig'), ' ');
  }

  const normalized = normalizeWhitespace(value);
  return normalized && normalized.length >= 2 ? normalized : undefined;
}

function extractCustomerName(utterance: string) {
  const normalized = normalizeWhitespace(utterance);

  if (!normalized) {
    return undefined;
  }

  const candidates = [
    normalized.match(/(?:안녕하세요[,.! ]*)?(.{2,30}?)(?:입니다|인데요|이구요|이고요|예요|이에요)(?:[.!? ]|$)/),
    normalized.match(/(?:저희|여기는|여기|거래처)\s*(.{2,30}?)(?:입니다|인데요|이에요|예요)(?:[.!? ]|$)/)
  ];

  for (const candidate of candidates) {
    const raw = normalizeWhitespace(candidate?.[1]);

    if (!raw) {
      continue;
    }

    const cleaned = normalizeWhitespace(
      raw
        .replace(/^(네|예|안녕하세요|저희는|저는)\s+/g, '')
        .replace(/\b(주문|발주|재고|견적|문의)\b.*$/g, '')
    );

    if (!cleaned || cleaned.length < 2) {
      continue;
    }

    if (containsAnyKeyword(cleaned.toLowerCase(), orderKeywords.concat(quoteKeywords, inventoryKeywords, techKeywords))) {
      continue;
    }

    return cleaned;
  }

  return undefined;
}

function normalizeCustomerNameHint(value?: string | null) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return null;
  }

  return normalized.toLowerCase().replace(/\s+/g, '');
}

function normalizeLookupToken(value?: string | null) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return null;
  }

  return normalized.toUpperCase().replace(/\s+/g, '');
}

function normalizeCompactLookupToken(value?: string | null) {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return null;
  }

  const compact = normalized.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length > 0 ? compact : null;
}

function pickResolvedProduct(input: {
  candidates: Array<ReturnType<typeof mapProductCandidate>>;
  currentProductCode?: string | undefined;
  productQuery?: string | undefined;
}) {
  if (input.candidates.length === 0) {
    return {
      resolved: null,
      resolutionMode: 'unresolved' as ProductResolutionMode
    };
  }

  if (input.currentProductCode) {
    const exactByCode = input.candidates.find(
      (candidate) => candidate.itemCode === input.currentProductCode
    );

    if (exactByCode) {
      return {
        resolved: exactByCode,
        resolutionMode: 'selected' as ProductResolutionMode
      };
    }
  }

  const exactLookupToken = normalizeLookupToken(input.productQuery);
  const compactLookupToken = normalizeCompactLookupToken(input.productQuery);
  const top = input.candidates[0];

  if (!top) {
    return {
      resolved: null,
      resolutionMode: 'unresolved' as ProductResolutionMode
    };
  }

  if (
    exactLookupToken !== null &&
    normalizeLookupToken(top.itemCode) === exactLookupToken
  ) {
    return {
      resolved: top,
      resolutionMode: 'item_exact' as ProductResolutionMode
    };
  }

  if (
    exactLookupToken !== null &&
    top.modelName &&
    normalizeLookupToken(top.modelName) === exactLookupToken
  ) {
    return {
      resolved: top,
      resolutionMode: 'model_exact' as ProductResolutionMode
    };
  }

  if (
    compactLookupToken !== null &&
    [top.itemCode, top.modelName]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeCompactLookupToken(value) === compactLookupToken)
  ) {
    return {
      resolved: top,
      resolutionMode: 'compact_exact' as ProductResolutionMode
    };
  }

  return {
    resolved: null,
    resolutionMode: input.candidates.length > 0 ? ('candidate_only' as ProductResolutionMode) : ('unresolved' as ProductResolutionMode)
  };
}

async function syncCallSession(
  app: FastifyInstance,
  callSessionId: string,
  input: {
    intent: IntentType;
    customerId?: string;
    handoffRequired: boolean;
    handoffTarget: HandoffTarget;
  }
) {
  await app.db.query(
    `
      update aicc.call_session
      set
        customer_id = coalesce(customer_id, $2::uuid),
        intent_type = case
          when intent_type is null or intent_type = 'other' then $3::aicc.call_intent_t
          else intent_type
        end,
        handoff_required = $4,
        handoff_target = $5::aicc.handoff_target_t
      where id = $1
    `,
    [callSessionId, input.customerId ?? null, input.intent, input.handoffRequired, input.handoffTarget]
  );
}

async function appendSystemEvent(
  app: FastifyInstance,
  callSessionId: string,
  metadata: Record<string, unknown>
) {
  await app.db.query(
    `
      insert into aicc.call_event (
        call_session_id,
        event_type,
        speaker,
        content,
        metadata
      )
      values ($1, 'system', 'system', $2, $3)
    `,
    [callSessionId, String(metadata.type ?? 'system'), JSON.stringify(metadata)]
  );
}

function countKeywordMatches(text: string, keywords: string[]) {
  return keywords.reduce(
    (count, keyword) => count + (text.includes(keyword.toLowerCase()) ? 1 : 0),
    0
  );
}

function containsAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function detectConfirmationSignal(text: string): 'yes' | 'no' | 'unknown' {
  const normalized = text.toLowerCase();

  if (containsAnyKeyword(normalized, negativeResponseKeywords)) {
    return 'no';
  }

  if (containsAnyKeyword(normalized, affirmativeKeywords)) {
    return 'yes';
  }

  return 'unknown';
}

function shortenText(value: string, maxLength: number) {
  const normalized = normalizeWhitespace(value) ?? '';
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
