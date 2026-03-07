import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env';
import { deliveryMethodLabels, type DeliveryMethod } from '../../lib/delivery';

const generatedSummarySchema = z.object({
  summaryText: z.string().min(1),
  inquiryType: z.enum(['order', 'inventory', 'quote', 'tech', 'other']),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'urgent']),
  resolved: z.boolean(),
  humanFollowupNeeded: z.boolean(),
  handoffTarget: z.enum(['sales', 'tech', 'none']),
  handoffReason: z.string().nullable(),
  customerName: z.string().nullable(),
  keyPoints: z.array(z.string()).max(6),
  actionItems: z.array(z.string()).max(6),
  products: z.array(
    z.object({
      productName: z.string(),
      productCode: z.string().nullable(),
      qty: z.number().nullable(),
      shippingMethod: z.string().nullable()
    })
  ).max(10),
  riskFlags: z.array(z.string()).max(6)
});

type GeneratedSummary = z.infer<typeof generatedSummarySchema>;

type SessionRow = {
  id: string;
  status: 'ringing' | 'live' | 'handoff' | 'completed' | 'failed';
  intent_type: 'order' | 'inventory' | 'quote' | 'tech' | 'other' | null;
  handoff_required: boolean;
  handoff_target: 'sales' | 'tech' | 'none';
  handoff_reason: string | null;
  caller_number: string;
  transcript_full: string | null;
  transcript_summary: Record<string, unknown>;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  customer_name: string | null;
  customer_code: string | null;
  deposit_required: boolean | null;
};

type EventRow = {
  event_type: string;
  speaker: string;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type DraftRow = {
  id: string;
  draft_kind: 'sale' | 'quote';
  shipping_method: DeliveryMethod | null;
  prepayment_required: boolean;
  requires_human_review: boolean;
  human_review_reason: string | null;
  status: string;
  erp_slip_no: string | null;
};

type DraftLineRow = {
  order_draft_id: string;
  product_code: string;
  product_name: string;
  qty: number;
};

type SummaryResult = {
  source: 'heuristic' | 'openai_responses' | 'heuristic_fallback';
  model?: string;
  generatedAt: string;
  summaryText: string;
  inquiryType: 'order' | 'inventory' | 'quote' | 'tech' | 'other';
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  resolved: boolean;
  humanFollowupNeeded: boolean;
  handoffTarget: 'sales' | 'tech' | 'none';
  handoffReason: string | null;
  customerName: string | null;
  keyPoints: string[];
  actionItems: string[];
  products: Array<{
    productName: string;
    productCode: string | null;
    qty: number | null;
    shippingMethod: string | null;
  }>;
  riskFlags: string[];
  llmError?: string;
};

const negativeKeywords = ['환불', '불만', '짜증', '화나', '클레임', '불량', '왜', '답답'];
const urgentKeywords = ['급', '빨리', '지금', '당장', '오늘', '긴급'];

export async function generateCallSummary(
  app: FastifyInstance,
  callSessionId: string,
  input?: {
    force?: boolean;
  }
) {
  const session = await loadSession(app, callSessionId);
  const existingSummary = readExistingSummary(session.transcript_summary);

  if (existingSummary && !input?.force) {
    return existingSummary;
  }

  const [events, drafts, draftLines] = await Promise.all([
    loadEvents(app, callSessionId),
    loadDrafts(app, callSessionId),
    loadDraftLines(app, callSessionId)
  ]);

  const heuristic = buildHeuristicSummary({
    session,
    events,
    drafts,
    draftLines
  });

  let summary: SummaryResult = heuristic;

  if (env.OPENAI_API_KEY) {
    try {
      const llmSummary = await generateSummaryWithOpenAi({
        session,
        events,
        drafts,
        draftLines,
        heuristic
      });

      summary = {
        ...llmSummary,
        source: 'openai_responses',
        model: env.OPENAI_SUMMARY_MODEL,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      summary = {
        ...heuristic,
        source: 'heuristic_fallback',
        generatedAt: new Date().toISOString(),
        llmError: error instanceof Error ? error.message : 'summary_generation_failed'
      };
    }
  }

  await app.db.query(
    `
      update aicc.call_session
      set
        transcript_summary = coalesce(transcript_summary, '{}'::jsonb) || $2::jsonb
      where id = $1
    `,
    [
      callSessionId,
      JSON.stringify({
        summary
      })
    ]
  );

  await app.db.query(
    `
      insert into aicc.call_event (
        call_session_id,
        event_type,
        speaker,
        content,
        metadata
      )
      values ($1, 'system', 'system', 'summary.generated', $2)
    `,
    [
      callSessionId,
      JSON.stringify({
        source: summary.source,
        inquiryType: summary.inquiryType,
        sentiment: summary.sentiment,
        humanFollowupNeeded: summary.humanFollowupNeeded
      })
    ]
  );

  return summary;
}

function buildHeuristicSummary(input: {
  session: SessionRow;
  events: EventRow[];
  drafts: DraftRow[];
  draftLines: DraftLineRow[];
}): SummaryResult {
  const transcript = input.session.transcript_full ?? buildTranscriptFromEvents(input.events);
  const inquiryType = inferInquiryType(input.session, transcript, input.drafts);
  const sentiment = inferSentiment(transcript, input.session.handoff_required);
  const resolved =
    input.session.status === 'completed' && !input.session.handoff_required && !hasOpenHumanReview(input.drafts);
  const handoffTarget = input.session.handoff_required ? input.session.handoff_target : 'none';
  const humanFollowupNeeded =
    input.session.handoff_required ||
    hasOpenHumanReview(input.drafts) ||
    input.drafts.some((draft) => draft.prepayment_required);
  const customerName = input.session.customer_name;
  const products = summarizeProducts(input.drafts, input.draftLines);
  const keyPoints = buildKeyPoints(input.session, input.drafts, products);
  const actionItems = buildActionItems(input.session, input.drafts);
  const riskFlags = buildRiskFlags(input.session, input.drafts, sentiment);

  return {
    source: 'heuristic',
    generatedAt: new Date().toISOString(),
    summaryText: buildSummaryText({
      customerName,
      inquiryType,
      resolved,
      handoffTarget,
      products,
      actionItems
    }),
    inquiryType,
    sentiment,
    resolved,
    humanFollowupNeeded,
    handoffTarget,
    handoffReason: input.session.handoff_reason,
    customerName,
    keyPoints,
    actionItems,
    products,
    riskFlags
  };
}

async function generateSummaryWithOpenAi(input: {
  session: SessionRow;
  events: EventRow[];
  drafts: DraftRow[];
  draftLines: DraftLineRow[];
  heuristic: SummaryResult;
}) {
  const transcript = truncateTranscript(
    input.session.transcript_full ?? buildTranscriptFromEvents(input.events)
  );

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.OPENAI_SUMMARY_MODEL,
      store: false,
      input: [
        {
          role: 'system',
          content:
            'You summarize Korean B2B phone calls for LANstar. Return JSON only. Do not invent facts not grounded in the provided transcript or structured metadata.'
        },
        {
          role: 'user',
          content: buildSummaryPrompt(input, transcript)
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'lanstar_call_summary',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              summaryText: { type: 'string' },
              inquiryType: {
                type: 'string',
                enum: ['order', 'inventory', 'quote', 'tech', 'other']
              },
              sentiment: {
                type: 'string',
                enum: ['positive', 'neutral', 'negative', 'urgent']
              },
              resolved: { type: 'boolean' },
              humanFollowupNeeded: { type: 'boolean' },
              handoffTarget: {
                type: 'string',
                enum: ['sales', 'tech', 'none']
              },
              handoffReason: {
                type: ['string', 'null']
              },
              customerName: {
                type: ['string', 'null']
              },
              keyPoints: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 6
              },
              actionItems: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 6
              },
              products: {
                type: 'array',
                maxItems: 10,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    productName: { type: 'string' },
                    productCode: { type: ['string', 'null'] },
                    qty: { type: ['number', 'null'] },
                    shippingMethod: { type: ['string', 'null'] }
                  },
                  required: ['productName', 'productCode', 'qty', 'shippingMethod']
                }
              },
              riskFlags: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 6
              }
            },
            required: [
              'summaryText',
              'inquiryType',
              'sentiment',
              'resolved',
              'humanFollowupNeeded',
              'handoffTarget',
              'handoffReason',
              'customerName',
              'keyPoints',
              'actionItems',
              'products',
              'riskFlags'
            ]
          }
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI summary failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const outputText = extractResponseText(payload);

  if (!outputText) {
    throw new Error('OpenAI summary returned empty output');
  }

  return generatedSummarySchema.parse(JSON.parse(outputText));
}

function buildSummaryPrompt(
  input: {
    session: SessionRow;
    events: EventRow[];
    drafts: DraftRow[];
    draftLines: DraftLineRow[];
    heuristic: SummaryResult;
  },
  transcript: string
) {
  const structuredContext = {
    call: {
      status: input.session.status,
      intentType: input.session.intent_type,
      handoffRequired: input.session.handoff_required,
      handoffTarget: input.session.handoff_target,
      handoffReason: input.session.handoff_reason,
      callerNumber: input.session.caller_number,
      customerName: input.session.customer_name,
      customerCode: input.session.customer_code,
      depositRequired: input.session.deposit_required,
      startedAt: input.session.started_at,
      answeredAt: input.session.answered_at,
      endedAt: input.session.ended_at
    },
    drafts: input.drafts.map((draft) => ({
      draftKind: draft.draft_kind,
      shippingMethod: draft.shipping_method ? deliveryMethodLabels[draft.shipping_method] : null,
      prepaymentRequired: draft.prepayment_required,
      requiresHumanReview: draft.requires_human_review,
      humanReviewReason: draft.human_review_reason,
      status: draft.status,
      slipNo: draft.erp_slip_no
    })),
    products: summarizeProducts(input.drafts, input.draftLines),
    heuristic: {
      summaryText: input.heuristic.summaryText,
      actionItems: input.heuristic.actionItems,
      riskFlags: input.heuristic.riskFlags
    }
  };

  return [
    '다음 한국어 B2B 전화상담 기록을 요약해 JSON으로 정리하세요.',
    '사실이 불명확하면 추정하지 말고 null 또는 빈 배열을 사용하세요.',
    'summaryText는 2문장 이내의 자연스러운 한국어로 작성하세요.',
    'keyPoints와 actionItems는 짧은 한국어 문장으로 작성하세요.',
    `구조화 메타데이터: ${JSON.stringify(structuredContext)}`,
    `전사: ${transcript || '(전사 없음)'}`
  ].join('\n\n');
}

function extractResponseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content
      : [];

    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const outputText = (part as { text?: unknown }).text;

      if (typeof outputText === 'string' && outputText.trim()) {
        return outputText;
      }
    }
  }

  return null;
}

async function loadSession(app: FastifyInstance, callSessionId: string) {
  const result = await app.db.query<SessionRow>(
    `
      select
        cs.id,
        cs.status,
        cs.intent_type,
        cs.handoff_required,
        cs.handoff_target,
        cs.handoff_reason,
        cs.caller_number,
        cs.transcript_full,
        cs.transcript_summary,
        cs.started_at::text,
        cs.answered_at::text,
        cs.ended_at::text,
        mc.customer_name,
        mc.customer_code,
        mc.deposit_required
      from aicc.call_session cs
      left join aicc.master_customer mc on mc.id = cs.customer_id
      where cs.id = $1
      limit 1
    `,
    [callSessionId]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error('Call session not found');
  }

  return row;
}

async function loadEvents(app: FastifyInstance, callSessionId: string) {
  const result = await app.db.query<EventRow>(
    `
      select event_type, speaker, content, metadata, created_at::text
      from aicc.call_event
      where call_session_id = $1
      order by created_at asc
    `,
    [callSessionId]
  );

  return result.rows;
}

async function loadDrafts(app: FastifyInstance, callSessionId: string) {
  const result = await app.db.query<DraftRow>(
    `
      select
        id,
        draft_kind,
        shipping_method,
        prepayment_required,
        requires_human_review,
        human_review_reason,
        status::text,
        erp_slip_no
      from aicc.order_draft
      where call_session_id = $1
      order by created_at desc
    `,
    [callSessionId]
  );

  return result.rows;
}

async function loadDraftLines(app: FastifyInstance, callSessionId: string) {
  const result = await app.db.query<DraftLineRow>(
    `
      select
        odl.order_draft_id::text,
        odl.product_code,
        odl.product_name,
        odl.qty::float8 as qty
      from aicc.order_draft_line odl
      join aicc.order_draft od on od.id = odl.order_draft_id
      where od.call_session_id = $1
      order by odl.created_at asc
    `,
    [callSessionId]
  );

  return result.rows;
}

function readExistingSummary(transcriptSummary: Record<string, unknown>) {
  const candidate = transcriptSummary.summary;

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  try {
    return generatedSummarySchema
      .extend({
        source: z.enum(['heuristic', 'openai_responses', 'heuristic_fallback']),
        model: z.string().optional(),
        generatedAt: z.string(),
        llmError: z.string().optional()
      })
      .parse(candidate);
  } catch {
    return null;
  }
}

function buildTranscriptFromEvents(events: EventRow[]) {
  return events
    .filter((event) => ['customer', 'ai', 'manager', 'agent'].includes(event.speaker))
    .map((event) => `${event.speaker}: ${event.content ?? ''}`.trim())
    .filter(Boolean)
    .join('\n');
}

function inferInquiryType(
  session: SessionRow,
  transcript: string,
  drafts: DraftRow[]
): 'order' | 'inventory' | 'quote' | 'tech' | 'other' {
  if (session.intent_type) {
    return session.intent_type;
  }

  if (drafts.some((draft) => draft.draft_kind === 'quote')) {
    return 'quote';
  }

  if (drafts.some((draft) => draft.draft_kind === 'sale')) {
    return 'order';
  }

  if (/견적|단가|가격/.test(transcript)) {
    return 'quote';
  }

  if (/재고|있나요|가능수량/.test(transcript)) {
    return 'inventory';
  }

  if (/드라이버|설치|고장|호환|초기화|인식/.test(transcript)) {
    return 'tech';
  }

  if (/주문|발주|출고|발송/.test(transcript)) {
    return 'order';
  }

  return 'other';
}

function inferSentiment(
  transcript: string,
  handoffRequired: boolean
): 'positive' | 'neutral' | 'negative' | 'urgent' {
  if (urgentKeywords.some((keyword) => transcript.includes(keyword))) {
    return 'urgent';
  }

  if (handoffRequired || negativeKeywords.some((keyword) => transcript.includes(keyword))) {
    return 'negative';
  }

  if (/감사|고맙/.test(transcript)) {
    return 'positive';
  }

  return 'neutral';
}

function summarizeProducts(drafts: DraftRow[], draftLines: DraftLineRow[]) {
  const shippingByDraftId = new Map(
    drafts.map((draft) => [
      draft.id,
      draft.shipping_method ? deliveryMethodLabels[draft.shipping_method] : null
    ])
  );

  return draftLines.slice(0, 10).map((line) => ({
    productName: line.product_name,
    productCode: line.product_code || null,
    qty: Number.isFinite(line.qty) ? line.qty : null,
    shippingMethod: shippingByDraftId.get(line.order_draft_id) ?? null
  }));
}

function buildKeyPoints(
  session: SessionRow,
  drafts: DraftRow[],
  products: SummaryResult['products']
) {
  const keyPoints: string[] = [];

  if (session.customer_name) {
    keyPoints.push(`거래처는 ${session.customer_name}입니다.`);
  }

  if (products[0]) {
    const first = products[0];
    keyPoints.push(
      `${first.productName}${first.qty !== null ? ` ${Number(first.qty)}개` : ''} 기준으로 상담이 진행되었습니다.`
    );
  }

  const shipping = products.find((product) => product.shippingMethod)?.shippingMethod;

  if (shipping) {
    keyPoints.push(`배송방법은 ${shipping} 기준입니다.`);
  }

  if (drafts.some((draft) => draft.prepayment_required)) {
    keyPoints.push('선결제 안내가 필요한 거래입니다.');
  }

  if (session.handoff_required && session.handoff_reason) {
    keyPoints.push(`사람 개입 사유는 ${session.handoff_reason}입니다.`);
  }

  return keyPoints.slice(0, 6);
}

function buildActionItems(session: SessionRow, drafts: DraftRow[]) {
  const actionItems: string[] = [];

  if (session.handoff_required) {
    actionItems.push(
      session.handoff_target === 'tech'
        ? '기술 담당자가 후속 확인을 진행해야 합니다.'
        : '영업 담당자가 후속 확인을 진행해야 합니다.'
    );
  }

  if (drafts.some((draft) => draft.prepayment_required)) {
    actionItems.push('선결제 확인 후 출고 여부를 다시 확인해야 합니다.');
  }

  for (const draft of drafts) {
    if (draft.requires_human_review && draft.human_review_reason) {
      actionItems.push(`주문 초안 검토 필요: ${draft.human_review_reason}`);
    }

    if (draft.erp_slip_no) {
      actionItems.push(`ERP 전표 ${draft.erp_slip_no} 상태를 확인합니다.`);
    }
  }

  if (actionItems.length === 0) {
    actionItems.push('즉시 필요한 추가 후속조치는 확인되지 않았습니다.');
  }

  return uniqueStrings(actionItems).slice(0, 6);
}

function buildRiskFlags(
  session: SessionRow,
  drafts: DraftRow[],
  sentiment: SummaryResult['sentiment']
) {
  const riskFlags: string[] = [];

  if (sentiment === 'negative' || sentiment === 'urgent') {
    riskFlags.push(`고객 감정 상태 ${sentiment}`);
  }

  if (session.handoff_required) {
    riskFlags.push('사람 개입 필요');
  }

  if (drafts.some((draft) => draft.prepayment_required)) {
    riskFlags.push('선결제 거래');
  }

  for (const draft of drafts) {
    if (draft.requires_human_review && draft.human_review_reason) {
      riskFlags.push(draft.human_review_reason);
    }
  }

  return uniqueStrings(riskFlags).slice(0, 6);
}

function buildSummaryText(input: {
  customerName: string | null;
  inquiryType: SummaryResult['inquiryType'];
  resolved: boolean;
  handoffTarget: SummaryResult['handoffTarget'];
  products: SummaryResult['products'];
  actionItems: string[];
}) {
  const customer = input.customerName ?? '고객';
  const productText = input.products[0]
    ? `${input.products[0].productName}${input.products[0].qty !== null ? ` ${Number(input.products[0].qty)}개` : ''}`
    : '문의 품목';
  const inquiryLabelMap: Record<SummaryResult['inquiryType'], string> = {
    order: '주문',
    inventory: '재고',
    quote: '견적',
    tech: '기술',
    other: '일반'
  };
  const outcome = input.resolved
    ? '통화 내에서 주요 안내가 마무리되었습니다.'
    : input.handoffTarget === 'tech'
      ? '기술 담당자 후속 조치가 필요합니다.'
      : input.handoffTarget === 'sales'
        ? '영업 담당자 후속 조치가 필요합니다.'
        : input.actionItems[0] ?? '추가 확인이 필요합니다.';

  return `${customer}의 ${inquiryLabelMap[input.inquiryType]} 문의입니다. ${productText} 중심으로 상담했으며 ${outcome}`;
}

function hasOpenHumanReview(drafts: DraftRow[]) {
  return drafts.some((draft) => draft.requires_human_review);
}

function truncateTranscript(transcript: string) {
  const maxChars = 12000;

  if (transcript.length <= maxChars) {
    return transcript;
  }

  return transcript.slice(-maxChars);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
