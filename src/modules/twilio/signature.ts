import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

export function validateTwilioSignature(input: {
  authToken: string;
  signature: string;
  url: string;
  params?: Record<string, unknown>;
}) {
  const payload = buildSignaturePayload(input.url, input.params ?? {});
  const expected = createHmac('sha1', input.authToken).update(payload, 'utf8').digest('base64');
  return safeCompare(expected, input.signature);
}

export function buildTwilioRequestUrl(
  request: FastifyRequest,
  publicBaseUrl?: string
) {
  const baseUrl = publicBaseUrl ?? inferPublicBaseUrl(request);

  if (!baseUrl) {
    return null;
  }

  const url = new URL(request.url, baseUrl);
  url.username = '';
  url.password = '';
  url.port = '';
  return url.toString();
}

function buildSignaturePayload(url: string, params: Record<string, unknown>) {
  const sortedKeys = Object.keys(params).sort();
  let payload = url;

  for (const key of sortedKeys) {
    const value = params[key];

    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        payload += key + String(item);
      }

      continue;
    }

    payload += key + String(value);
  }

  return payload;
}

function inferPublicBaseUrl(request: FastifyRequest) {
  const host = typeof request.headers.host === 'string' ? request.headers.host : null;
  const forwardedProto =
    typeof request.headers['x-forwarded-proto'] === 'string'
      ? request.headers['x-forwarded-proto']
      : null;
  const proto = forwardedProto ?? 'https';
  return host ? `${proto}://${host}` : null;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
