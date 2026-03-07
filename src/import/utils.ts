import { normalizeDigits, normalizeWhitespace } from '../lib/normalize';

export function chunkArray<T>(items: T[], size: number): T[][];
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function cleanCell(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\t/g, ' ').replace(/\u00a0/g, ' ');
  return normalizeWhitespace(normalized);
}

export function normalizeSearchText(value: string | null | undefined): string | null {
  const cleaned = cleanCell(value);

  if (!cleaned) {
    return null;
  }

  return cleaned
    .toLowerCase()
    .replace(/[\[\]\(\),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchText(values: Array<string | null | undefined>): string {
  return Array.from(
    new Set(
      values
        .flatMap((value) => {
          const cleaned = cleanCell(value);
          const normalized = normalizeSearchText(value);
          return [cleaned, normalized];
        })
        .filter((value): value is string => Boolean(value))
    )
  ).join(' ');
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = cleanCell(value);

  if (!cleaned || cleaned === '불가' || cleaned === '-') {
    return null;
  }

  const numeric = cleaned.replace(/[^\d.-]/g, '');

  if (!numeric) {
    return null;
  }

  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => cleanCell(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function extractBracketBrand(productName: string | null | undefined): string | null {
  if (!productName) {
    return null;
  }

  const match = productName.match(/^\[([^\]]+)\]/);
  return match ? cleanCell(match[1]) : null;
}

export function stripBracketBrand(productName: string | null | undefined): string | null {
  const cleaned = cleanCell(productName);

  if (!cleaned) {
    return null;
  }

  return cleanCell(cleaned.replace(/^\[[^\]]+\]\s*/, ''));
}

export function inferYongsanArea(address: string | null | undefined): boolean {
  const cleaned = cleanCell(address);
  return cleaned ? cleaned.includes('서울 용산') || cleaned.includes('용산구') : false;
}

export function normalizeCustomerName(value: string | null | undefined): string | null {
  const normalized = normalizeSearchText(value);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/\s+/g, '');
}

export function buildProductAliases(input: {
  brand: string | null;
  itemCode: string;
  productName: string;
  modelName: string | null;
  specText: string | null;
}): string[] {
  const aliases = uniqueStrings([
    input.itemCode,
    input.productName,
    stripBracketBrand(input.productName),
    input.modelName,
    input.specText
  ]);

  const normalizedAliases = aliases.flatMap((alias) => {
    const normalized = normalizeSearchText(alias);
    return normalized && normalized !== alias ? [alias, normalized] : [alias];
  });

  if (input.brand) {
    normalizedAliases.push(input.brand);
  }

  return Array.from(new Set(normalizedAliases.filter(Boolean)));
}

export function extractModelCandidates(value: string | null | undefined): string[] {
  const cleaned = cleanCell(value);

  if (!cleaned) {
    return [];
  }

  const matches = cleaned.match(/\b[A-Z]{1,8}-[A-Z0-9][A-Z0-9-]*\b/g) ?? [];
  return Array.from(new Set(matches));
}

export function summarizeTalkMessages(
  messages: Array<{ 발신자?: string; 내용?: string }>
): {
  customerText: string;
  sellerText: string;
  resolved: boolean | null;
} {
  const customerLines: string[] = [];
  const sellerLines: string[] = [];

  for (const message of messages) {
    const speaker = cleanCell(message.발신자);
    const content = cleanCell(message.내용);

    if (!content) {
      continue;
    }

    if (speaker === '고객') {
      customerLines.push(content);
    } else if (speaker === '판매자') {
      sellerLines.push(content);
    }
  }

  const customerText = customerLines.join('\n');
  const sellerText = sellerLines.join('\n');
  const resolvedText = `${customerText}\n${sellerText}`;

  let resolved: boolean | null = null;

  if (/해결|감사|잘 됩니다|되었습니다|됐습니다|됬습니다/i.test(resolvedText)) {
    resolved = true;
  } else if (/교환|환불|불량|안 됩니다|안되/i.test(resolvedText)) {
    resolved = false;
  }

  return {
    customerText,
    sellerText,
    resolved
  };
}

export { normalizeDigits };

