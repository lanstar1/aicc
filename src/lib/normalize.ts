export function normalizeDigits(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export function normalizeWhitespace(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

