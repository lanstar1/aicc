import type { PoolClient } from 'pg';

import type { TechChunkSeed, TechModelSeed } from './types';
import { insertMany } from './db';
import { getSourceUpdatedAt, readTextSource } from './source-reader';
import {
  buildSearchText,
  cleanCell,
  extractModelCandidates,
  normalizeSearchText,
  summarizeTalkMessages
} from './utils';

type MergedTechItem = {
  model: string;
  product_name: string;
  category?: string;
  qna_count?: number;
  qna?: Array<{
    question?: string;
    answer?: string;
    original_product_name?: string;
  }>;
};

type RawQnaItem = {
  상품명?: string;
  문의?: string;
  답변?: string;
};

type TalkOrderItem = {
  고객명?: string;
  구매이력?: Array<{
    주문날짜?: string;
    주문번호?: string;
    상품목록?: Array<{
      상태?: string;
      상품명?: string;
      가격?: string;
    }>;
  }>;
  대화내용?: Array<{
    발신자?: string;
    내용?: string;
  }>;
};

export async function loadTechSeeds(paths: {
  mergedTechJson: string;
  rawQnaJson: string;
  talkOrderJson: string;
}): Promise<{
  models: TechModelSeed[];
  chunks: TechChunkSeed[];
}> {
  const [mergedUpdatedAt, mergedItems, rawQnaItems, talkItems] = await Promise.all([
    getSourceUpdatedAt(paths.mergedTechJson),
    readJson<MergedTechItem[]>(paths.mergedTechJson),
    readJson<RawQnaItem[]>(paths.rawQnaJson),
    readJson<TalkOrderItem[]>(paths.talkOrderJson)
  ]);

  const mergedModels: TechModelSeed[] = [];

  for (const item of mergedItems) {
    const modelName = cleanCell(item.model);
    const productName = cleanCell(item.product_name);

    if (!modelName || !productName) {
      continue;
    }

    mergedModels.push({
      brand: 'LANstar',
      modelName,
      productName,
      category: cleanCell(item.category),
      qnaCount: item.qna_count ?? item.qna?.length ?? 0,
      searchText: buildSearchText([modelName, productName, item.category]),
      sourceUpdatedAt: mergedUpdatedAt
    });
  }

  const resolvedModelMap = new Map(
    mergedModels.map((model) => [model.modelName.toUpperCase(), model.modelName])
  );
  const productNameMap = new Map(
    mergedModels.map((model) => [normalizeSearchText(model.productName) ?? model.productName, model.modelName])
  );

  const mergedChunks: TechChunkSeed[] = [];

  for (const item of mergedItems) {
    const modelName = cleanCell(item.model);
    const productName = cleanCell(item.product_name);

    if (!modelName || !productName) {
      continue;
    }

    for (const entry of item.qna ?? []) {
      const question = cleanCell(entry.question);
      const answer = cleanCell(entry.answer);

      if (!question || !answer) {
        continue;
      }

      mergedChunks.push({
        modelName,
        sourceType: 'merged_json',
        rawProductName: cleanCell(entry.original_product_name) ?? productName,
        question,
        answer,
        searchText: buildSearchText([modelName, productName, question, answer]),
        resolved: true,
        answerQuality: 1,
        metadata: {
          category: cleanCell(item.category),
          qnaCount: item.qna_count ?? item.qna?.length ?? 0
        }
      });
    }
  }

  const rawQnaChunks: TechChunkSeed[] = [];

  for (const item of rawQnaItems) {
    const rawProductName = cleanCell(item.상품명);
    const question = cleanCell(item.문의);
    const answer = cleanCell(item.답변);

    if (!question || !answer) {
      continue;
    }

    const modelName = resolveModelName(rawProductName, resolvedModelMap, productNameMap);

    rawQnaChunks.push({
      modelName,
      sourceType: 'raw_qna',
      rawProductName,
      question,
      answer,
      searchText: buildSearchText([rawProductName, modelName, question, answer]),
      resolved: true,
      answerQuality: 0.8,
      metadata: {}
    });
  }

  const talkChunks: TechChunkSeed[] = [];

  for (const item of talkItems) {
    const talkSummary = summarizeTalkMessages(item.대화내용 ?? []);

    if (!talkSummary.customerText) {
      continue;
    }

    const rawProductName = cleanCell(item.구매이력?.[0]?.상품목록?.[0]?.상품명);
    const modelName = resolveModelName(rawProductName, resolvedModelMap, productNameMap);

    talkChunks.push({
      modelName,
      sourceType: 'talk_data',
      rawProductName,
      question: talkSummary.customerText,
      answer: talkSummary.sellerText,
      searchText: buildSearchText([rawProductName, modelName, talkSummary.customerText, talkSummary.sellerText]),
      resolved: talkSummary.resolved,
      answerQuality: 0.5,
      metadata: {
        customerName: cleanCell(item.고객명),
        orderCount: item.구매이력?.length ?? 0
      }
    });
  }

  return {
    models: mergedModels,
    chunks: [...mergedChunks, ...rawQnaChunks, ...talkChunks]
  };
}

export async function replaceTechData(
  client: PoolClient,
  seeds: {
    models: TechModelSeed[];
    chunks: TechChunkSeed[];
  }
) {
  await client.query('delete from aicc.tech_qa_chunk');
  await client.query('delete from aicc.tech_model');

  await insertMany(
    client,
    'aicc.tech_model',
    ['brand', 'model_name', 'product_name', 'category', 'qna_count', 'search_text', 'source_updated_at'],
    seeds.models.map((model) => [
      model.brand,
      model.modelName,
      model.productName,
      model.category,
      model.qnaCount,
      model.searchText,
      model.sourceUpdatedAt
    ])
  );

  const techModelResult = await client.query<{ id: string; model_name: string }>(
    'select id, model_name from aicc.tech_model'
  );
  const techModelIdByName = new Map(
    techModelResult.rows.map((row) => [row.model_name.toUpperCase(), row.id])
  );

  await insertMany(
    client,
    'aicc.tech_qa_chunk',
    [
      'tech_model_id',
      'source_type',
      'raw_product_name',
      'question',
      'answer',
      'search_text',
      'resolved',
      'answer_quality',
      'metadata'
    ],
    seeds.chunks.map((chunk) => [
      chunk.modelName ? techModelIdByName.get(chunk.modelName.toUpperCase()) ?? null : null,
      chunk.sourceType,
      chunk.rawProductName,
      chunk.question,
      chunk.answer,
      chunk.searchText,
      chunk.resolved,
      chunk.answerQuality,
      JSON.stringify(chunk.metadata)
    ])
  );
}

async function readJson<T>(path: string): Promise<T> {
  const content = await readTextSource(path);
  return JSON.parse(content) as T;
}

function resolveModelName(
  rawProductName: string | null,
  resolvedModelMap: Map<string, string>,
  productNameMap: Map<string, string>
): string | null {
  const normalizedProduct = normalizeSearchText(rawProductName);

  if (normalizedProduct && productNameMap.has(normalizedProduct)) {
    return productNameMap.get(normalizedProduct) ?? null;
  }

  for (const candidate of extractModelCandidates(rawProductName)) {
    const resolved = resolvedModelMap.get(candidate.toUpperCase());

    if (resolved) {
      return resolved;
    }
  }

  return null;
}
