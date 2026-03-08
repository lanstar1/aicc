import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { buildApp } from '../app';
import type { ConversationState } from '../modules/orchestrator/service';
import { analyzeTurn } from '../modules/orchestrator/service';
import { resolveTurnResponse } from '../modules/orchestrator/turn-runtime';

const scenarioTurnSchema = z.object({
  utterance: z.string().trim().min(1),
  hints: z
    .object({
      customerName: z.string().trim().optional(),
      brand: z.string().trim().optional(),
      productQuery: z.string().trim().optional(),
      qty: z.number().positive().optional(),
      shippingMethod: z.string().trim().optional()
    })
    .partial()
    .optional(),
  statePatch: z
    .object({
      intentType: z.enum(['order', 'inventory', 'quote', 'tech', 'other']).optional(),
      customerId: z.string().uuid().optional(),
      customerConfirmed: z.boolean().optional(),
      orderConfirmed: z.boolean().optional(),
      pendingConfirmation: z.enum(['customer', 'product', 'order']).nullable().optional(),
      customerType: z.enum(['existing', 'new']).optional(),
      brand: z.string().trim().optional(),
      productQuery: z.string().trim().optional(),
      productId: z.string().uuid().optional(),
      productCode: z.string().trim().optional(),
      productName: z.string().trim().optional(),
      pendingProductId: z.string().uuid().optional(),
      pendingProductCode: z.string().trim().optional(),
      pendingProductName: z.string().trim().optional(),
      qty: z.number().positive().optional(),
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
      assistantRepeatCount: z.number().int().nonnegative().optional(),
      repeatedQuestionCount: z.number().int().nonnegative().optional(),
      elapsedSeconds: z.number().int().nonnegative().optional(),
      repairCount: z.number().int().nonnegative().optional(),
      customerCandidateCount: z.number().int().nonnegative().optional(),
      productCandidateCount: z.number().int().nonnegative().optional(),
      customerResolutionMode: z
        .enum(['selected', 'phone_exact', 'name_exact', 'phone_name_fuzzy', 'candidate_only', 'unresolved'])
        .optional(),
      productResolutionMode: z
        .enum(['selected', 'item_exact', 'model_exact', 'compact_exact', 'candidate_only', 'unresolved'])
        .optional(),
      conversationStage: z
        .enum(['opening', 'customer', 'product', 'quantity', 'delivery', 'confirmation', 'inventory', 'quote', 'tech', 'handoff', 'resolved'])
        .optional(),
      lastCustomerNameHint: z.string().trim().optional(),
      lastProductQuery: z.string().trim().optional(),
      lastSuggestedPrompt: z.string().trim().optional()
    })
    .partial()
    .optional()
});

const scenarioSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  callerNumber: z.string().trim().optional(),
  initialState: scenarioTurnSchema.shape.statePatch.optional(),
  turns: z.array(scenarioTurnSchema).min(1)
});

type Scenario = z.infer<typeof scenarioSchema>;

const builtinScenarios: Record<string, Scenario> = {
  'order-confirm-lanstar': {
    name: 'order-confirm-lanstar',
    description: '품목코드가 확정된 주문 확인 응답 이후 저장 흐름을 검증합니다.',
    initialState: {
      intentType: 'order',
      customerType: 'existing',
      brand: 'LANstar',
      productQuery: 'cat6 5m red',
      productCode: 'LS-6UTPD-5MR',
      qty: 10,
      shippingMethod: 'delivery',
      pendingConfirmation: 'order'
    },
    turns: [
      {
        utterance: '네 맞습니다'
      }
    ]
  },
  'inventory-lanstar': {
    name: 'inventory-lanstar',
    description: '품목코드가 이미 확정된 재고 안내 흐름을 검증합니다.',
    initialState: {
      intentType: 'inventory',
      customerType: 'existing',
      brand: 'LANstar',
      productCode: 'LS-6UTPD-5MR',
      qty: 10
    },
    turns: [
      {
        utterance: '이 제품 재고 있을까요?'
      }
    ]
  },
  'quote-lanstar': {
    name: 'quote-lanstar',
    description: '랜스타 기준 견적 안내 흐름을 검증합니다.',
    initialState: {
      intentType: 'quote',
      customerType: 'existing',
      brand: 'LANstar',
      productCode: 'LS-6UTPD-5MR',
      qty: 10
    },
    turns: [
      {
        utterance: '이 제품 견적 부탁드립니다'
      }
    ]
  },
  'tech-hdmi-splitter': {
    name: 'tech-hdmi-splitter',
    description: '기술문의 KB 검색과 전화용 요약 응답을 검증합니다.',
    initialState: {
      intentType: 'tech',
      brand: 'LANstar',
      productQuery: 'LS-HD2016N EDID 설정'
    },
    turns: [
      {
        utterance: 'LS-HD2016N EDID 설정이 뭔가요?'
      }
    ]
  }
};

async function main() {
  const args = parseArgs({
    options: {
      scenario: {
        type: 'string'
      },
      'scenario-file': {
        type: 'string'
      },
      'caller-number': {
        type: 'string'
      },
      'persist-draft': {
        type: 'boolean',
        default: false
      },
      'save-to-erp': {
        type: 'boolean',
        default: false
      },
      json: {
        type: 'boolean',
        default: false
      },
      list: {
        type: 'boolean',
        default: false
      }
    }
  });

  if (args.values.list) {
    printScenarioList();
    return;
  }

  const scenarioOptions: Parameters<typeof loadScenario>[0] = {};

  if (args.values.scenario) {
    scenarioOptions.scenarioName = args.values.scenario;
  }

  if (args.values['scenario-file']) {
    scenarioOptions.scenarioFile = args.values['scenario-file'];
  }

  const scenario = await loadScenario(scenarioOptions);
  const persistDraft = args.values['persist-draft'] || args.values['save-to-erp'];
  const saveToErp = args.values['save-to-erp'];
  const callerNumber = args.values['caller-number'] ?? scenario.callerNumber;
  const app = await buildApp();

  await app.ready();

  try {
    const runOptions: Parameters<typeof runScenario>[2] = {
      persistDraft,
      saveToErp
    };

    if (callerNumber) {
      runOptions.callerNumber = callerNumber;
    }

    const result = await runScenario(app, scenario, runOptions);

    if (args.values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printScenarioResult(result);
  } finally {
    await app.close();
  }
}

async function loadScenario(input: {
  scenarioName?: string;
  scenarioFile?: string;
}) {
  if (input.scenarioFile) {
    const raw = await readFile(input.scenarioFile, 'utf-8');
    return scenarioSchema.parse(JSON.parse(raw));
  }

  const scenarioName = input.scenarioName ?? 'order-confirm-lanstar';
  const scenario = builtinScenarios[scenarioName];

  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioName}`);
  }

  return scenario;
}

async function runScenario(
  app: Awaited<ReturnType<typeof buildApp>>,
  scenario: Scenario,
  options: {
    persistDraft: boolean;
    saveToErp: boolean;
    callerNumber?: string;
  }
) {
  let state = mergeState({}, scenario.initialState ?? {});
  const turnResults = [];

  for (let index = 0; index < scenario.turns.length; index += 1) {
    const turn = scenario.turns[index];

    if (!turn) {
      continue;
    }

    const stateBefore = mergeState({}, state);

    state = mergeState(state, turn.statePatch ?? {});

    const analyzeInput: Parameters<typeof analyzeTurn>[1] = {
      utterance: turn.utterance,
      persistEvent: false,
      state
    };

    if (options.callerNumber) {
      analyzeInput.callerNumber = options.callerNumber;
    }

    if (turn.hints) {
      const hints: NonNullable<Parameters<typeof analyzeTurn>[1]['hints']> = {};

      if (turn.hints.customerName) {
        hints.customerName = turn.hints.customerName;
      }

      if (turn.hints.brand) {
        hints.brand = turn.hints.brand;
      }

      if (turn.hints.productQuery) {
        hints.productQuery = turn.hints.productQuery;
      }

      if (turn.hints.qty !== undefined) {
        hints.qty = turn.hints.qty;
      }

      if (turn.hints.shippingMethod) {
        hints.shippingMethod = turn.hints.shippingMethod;
      }

      analyzeInput.hints = hints;
    }

    const analysis = await analyzeTurn(app, analyzeInput);

    state = mergeState(state, analysis.statePatch);

    const resolution = await resolveTurnResponse(app, {
      analysis,
      state,
      persistDraft: options.persistDraft,
      autoSaveToErp: options.saveToErp
    });

    state = mergeState(state, resolution.statePatch ?? {});

    turnResults.push({
      turnIndex: index + 1,
      utterance: turn.utterance,
      hints: turn.hints ?? null,
      stateBefore,
      analysis,
      resolution,
      stateAfter: mergeState({}, state)
    });
  }

  return {
    scenario: {
      name: scenario.name,
      description: scenario.description ?? null
    },
    options: {
      callerNumber: options.callerNumber ?? null,
      persistDraft: options.persistDraft,
      saveToErp: options.saveToErp
    },
    finishedAt: new Date().toISOString(),
    turns: turnResults,
    finalState: state
  };
}

function printScenarioList() {
  const entries = Object.values(builtinScenarios).map((scenario) => ({
    name: scenario.name,
    description: scenario.description ?? ''
  }));
  console.log(JSON.stringify(entries, null, 2));
}

function printScenarioResult(result: Awaited<ReturnType<typeof runScenario>>) {
  console.log(`Scenario: ${result.scenario.name}`);

  if (result.scenario.description) {
    console.log(`Description: ${result.scenario.description}`);
  }

  console.log(
    `Options: persistDraft=${result.options.persistDraft} saveToErp=${result.options.saveToErp} callerNumber=${result.options.callerNumber ?? 'none'}`
  );
  console.log('');

  for (const turn of result.turns) {
    const topCustomer = turn.analysis.customer ?? turn.analysis.customerCandidates[0] ?? null;
    const topProduct = turn.analysis.productCandidates[0] ?? null;
    const topTech = turn.analysis.techCandidates[0] ?? null;

    console.log(`[Turn ${turn.turnIndex}] 고객: ${turn.utterance}`);
    console.log(
      `  분석: intent=${turn.analysis.intent} next=${turn.analysis.nextAction} confidence=${turn.analysis.confidence}`
    );

    if (topCustomer) {
      console.log(`  거래처: ${topCustomer.customerName} (${topCustomer.customerCode})`);
    }

    if (topProduct) {
      console.log(`  품목: ${topProduct.productName} [${topProduct.itemCode}]`);
    }

    if (topTech) {
      console.log(`  기술근거: ${topTech.modelName} / score=${topTech.score}`);
    }

    if (turn.analysis.handoffRequired) {
      console.log(
        `  이관: ${turn.analysis.handoffTarget} (${turn.analysis.handoffReasons.join(', ')})`
      );
    }

    console.log(`  응답(${turn.resolution.source}): ${turn.resolution.responseText ?? '-'}`);

    if (turn.resolution.preview) {
      const preview = turn.resolution.preview;
      console.log(
        `  미리보기: shipping=${preview.shippingMethodLabel} total=${formatNumber(preview.totalAmount)} humanReview=${preview.requiresHumanReview}`
      );
    }

    if (turn.resolution.workflowResult) {
      console.log(`  워크플로: ${turn.resolution.workflowResult.nextStep}`);
    }

    console.log(`  상태: ${formatState(turn.stateAfter)}`);
    console.log('');
  }

  console.log(`Final State: ${formatState(result.finalState)}`);
}

function formatState(state: ConversationState) {
  const compact = {
    intentType: state.intentType ?? null,
    customerId: state.customerId ?? null,
    customerType: state.customerType ?? null,
    brand: state.brand ?? null,
    productCode: state.productCode ?? null,
    qty: state.qty ?? null,
    shippingMethod: state.shippingMethod ?? null,
    pendingConfirmation: state.pendingConfirmation ?? null,
    orderConfirmed: state.orderConfirmed ?? null
  };
  return JSON.stringify(compact);
}

function formatNumber(value: number | null) {
  if (value === null) {
    return '-';
  }

  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function mergeState<T extends Record<string, unknown>>(base: T, patch: Partial<T>) {
  const next = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }

  return next;
}

void main();
