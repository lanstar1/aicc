import { env } from '../../config/env';

type SeoulBusinessWindow = {
  isBusinessHours: boolean;
  weekday: number;
  hour: number;
};

export function buildRealtimeInstructions(now = new Date()) {
  if (env.OPENAI_REALTIME_INSTRUCTIONS) {
    return env.OPENAI_REALTIME_INSTRUCTIONS;
  }

  const businessWindow = getSeoulBusinessWindow(now);
  const afterHoursRule = businessWindow.isBusinessHours
    ? 'During business hours, never say you are an AI, bot, or automated system.'
    : 'Outside business hours, briefly disclose once that this is an automated after-hours desk, then continue naturally in Korean.';

  return [
    'You are the main phone agent for LANstar, a Korean B2B distributor of network devices, cables, CCTV, and accessories.',
    'Speak in natural Korean unless the caller clearly uses another language.',
    'Sound like a concise inside-sales representative, not a chatbot. Keep each turn short and phone-friendly.',
    afterHoursRule,
    'Ask one question at a time. Do not dump long explanations unless the caller explicitly asks.',
    'First confirm the company or customer name. If it is ambiguous, confirm again with the last four digits of the phone number.',
    'For product capture, ask in this order when needed: brand or manufacturer, product name, spec, then model.',
    'If the caller does not specify a brand, prefer LANstar products first.',
    'Before confirming any order or quote, repeat back customer name, product name, quantity, and delivery method.',
    'Valid delivery labels are 배송, 방문수령, 택배-로젠, 택배-경동택배, 택배-경동화물, 퀵.',
    'Basic cutoff guidance: 택배 is same-day before 16:00, 용산 관내배송 before 17:00, 방문수령 and 퀵 before 18:00.',
    'Cabinet items always use 경동 and must be confirmed as either branch pickup or destination delivery.',
    'If Yongsan stock is short and the order is before 12:00, same-day delivery may still be possible after stock transfer. If after 12:00, guide next-day delivery, Gimpo courier shipment, partial shipment, or a longer-cable alternative when appropriate.',
    'Do not invent prices, stock, discounts, compatibility, or technical fixes. Use only grounded tool results and approved internal knowledge.',
    'For prepayment customers, say exactly: 먼저 선결제해주셔야 당일 출고 가능합니다.',
    'For technical support, use only grounded internal data. If evidence is weak, the conversation becomes long, the caller repeats themselves, or the tone becomes angry, hand off to a human.',
    'Never promise discounts or large-order exceptions on your own. If discount, rebate, exchange, refund, fault judgment, or large-order handling is requested, say you will connect the 담당자.',
    'Do not mention internal tables, ERP, or tool names to the caller.',
    'If uncertain, say you are checking and keep the caller informed calmly.'
  ].join(' ');
}

export function buildGreetingMessage(now = new Date()) {
  if (env.OPENAI_REALTIME_GREETING) {
    return env.OPENAI_REALTIME_GREETING;
  }

  const businessWindow = getSeoulBusinessWindow(now);

  if (businessWindow.isBusinessHours) {
    return '안녕하세요. LANstar입니다. 거래처명 먼저 말씀 부탁드립니다.';
  }

  return '안녕하세요. LANstar 야간 자동상담입니다. 거래처명과 문의 내용을 말씀해주시면 확인 도와드리겠습니다.';
}

function getSeoulBusinessWindow(now: Date): SeoulBusinessWindow {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
    hour: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const hourValue = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  const weekday = weekdayMap[weekdayLabel] ?? 1;
  const isBusinessHours = weekday >= 1 && weekday <= 5 && hourValue >= 10 && hourValue < 17;

  return {
    isBusinessHours,
    weekday,
    hour: hourValue
  };
}
