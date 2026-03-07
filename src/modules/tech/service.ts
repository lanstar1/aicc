import type { FastifyInstance } from 'fastify';

import { normalizeWhitespace } from '../../lib/normalize';

type TechSearchRow = {
  tech_chunk_id: string;
  tech_model_id: string | null;
  brand: string;
  model_name: string;
  product_name: string;
  category: string | null;
  question: string;
  answer: string;
  qna_count: number;
  score: number;
};

export type TechKnowledgeCandidate = {
  chunkId: string;
  modelId: string | null;
  brand: string;
  modelName: string;
  productName: string;
  category: string | null;
  question: string;
  answer: string;
  answerSnippet: string;
  score: number;
};

export async function searchTechKnowledge(
  app: FastifyInstance,
  rawQuery: string,
  limit = 5
) {
  const query = normalizeWhitespace(rawQuery);

  if (!query || query.length < 2) {
    return [];
  }

  const qLike = `%${query}%`;
  const result = await app.db.query<TechSearchRow>(
    `
      select
        tq.id::text as tech_chunk_id,
        tm.id::text as tech_model_id,
        tm.brand,
        tm.model_name,
        tm.product_name,
        tm.category,
        tq.question,
        tq.answer,
        tm.qna_count,
        (
          greatest(
            similarity(tq.search_text, $1),
            similarity(coalesce(tm.search_text, ''), $1),
            similarity(tm.model_name, $1),
            similarity(tm.product_name, $1)
          ) * 20
          +
          case
            when tq.question ilike $2 then 10
            else 0
          end
          +
          case
            when tq.answer ilike $2 then 10
            else 0
          end
        ) as score
      from aicc.tech_qa_chunk tq
      left join aicc.tech_model tm on tm.id = tq.tech_model_id
      where
        tq.search_text ilike $2
        or coalesce(tm.search_text, '') ilike $2
        or coalesce(tm.model_name, '') ilike $2
        or coalesce(tm.product_name, '') ilike $2
      order by score desc, tm.qna_count desc, tq.created_at desc
      limit $3
    `,
    [query, qLike, limit]
  );

  return result.rows.map<TechKnowledgeCandidate>((row) => ({
    chunkId: row.tech_chunk_id,
    modelId: row.tech_model_id,
    brand: row.brand,
    modelName: row.model_name,
    productName: row.product_name,
    category: row.category,
    question: row.question,
    answer: row.answer,
    answerSnippet: shortenText(row.answer, 220),
    score: Number(row.score.toFixed(2))
  }));
}

export async function buildTechAnswerPreview(
  app: FastifyInstance,
  input: {
    query: string;
    modelName?: string;
    productName?: string;
    limit?: number;
  }
) {
  const parts = [
    normalizeWhitespace(input.modelName),
    normalizeWhitespace(input.productName),
    normalizeWhitespace(input.query)
  ].filter((value): value is string => Boolean(value));
  const searchQuery = parts.join(' ');
  const candidates = await searchTechKnowledge(app, searchQuery, input.limit ?? 5);
  const topModels = dedupeByModel(candidates).slice(0, 3);
  const confidence = candidates[0] ? scoreToConfidence(candidates[0].score) : 0.15;
  const requiresHumanReview =
    candidates.length === 0 ||
    confidence < 0.55 ||
    containsEscalationKeyword(searchQuery);

  return {
    query: searchQuery,
    confidence,
    requiresHumanReview,
    reasons: collectReviewReasons(searchQuery, candidates, confidence),
    modelCandidates: topModels.map((candidate) => ({
      modelId: candidate.modelId,
      brand: candidate.brand,
      modelName: candidate.modelName,
      productName: candidate.productName,
      category: candidate.category,
      score: candidate.score
    })),
    answerCandidates: candidates.map((candidate) => ({
      chunkId: candidate.chunkId,
      brand: candidate.brand,
      modelName: candidate.modelName,
      productName: candidate.productName,
      question: candidate.question,
      answerSnippet: candidate.answerSnippet,
      score: candidate.score
    })),
    recommendedAnswer: buildRecommendedAnswer(candidates)
  };
}

function dedupeByModel(candidates: TechKnowledgeCandidate[]) {
  const seen = new Set<string>();
  const deduped: TechKnowledgeCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.modelId ?? `${candidate.brand}:${candidate.modelName}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function buildRecommendedAnswer(candidates: TechKnowledgeCandidate[]) {
  if (candidates.length === 0) {
    return null;
  }

  const top = candidates[0];

  if (!top) {
    return null;
  }

  const lines = [
    `${top.brand} ${top.productName} 기준으로 확인된 자료입니다.`,
    shortenText(top.answer, 320)
  ];

  const second = candidates[1];

  if (second && second.modelName === top.modelName) {
    lines.push(`추가 참고: ${shortenText(second.answer, 140)}`);
  }

  return lines.join(' ');
}

function collectReviewReasons(
  query: string,
  candidates: TechKnowledgeCandidate[],
  confidence: number
) {
  const reasons: string[] = [];

  if (candidates.length === 0) {
    reasons.push('no_internal_match');
  }

  if (confidence < 0.55) {
    reasons.push('low_confidence');
  }

  if (containsEscalationKeyword(query)) {
    reasons.push('possible_fault_or_return');
  }

  return reasons;
}

function containsEscalationKeyword(value: string) {
  const text = value.toLowerCase();
  return ['불량', '교환', '환불', '회수', 'rma', '고장', 'as'].some((keyword) =>
    text.includes(keyword.toLowerCase())
  );
}

function scoreToConfidence(score: number) {
  if (score >= 20) {
    return 0.9;
  }

  if (score >= 14) {
    return 0.75;
  }

  if (score >= 9) {
    return 0.6;
  }

  return 0.35;
}

function shortenText(value: string, maxLength: number) {
  const normalized = normalizeWhitespace(value) ?? '';
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}
