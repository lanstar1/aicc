export const deliveryMethodLabels = {
  delivery: '배송',
  pickup: '방문수령',
  courier_rogen: '택배-로젠',
  courier_kd_parcel: '택배-경동택배',
  courier_kd_freight: '택배-경동화물',
  quick: '퀵'
} as const;

export type DeliveryMethod = keyof typeof deliveryMethodLabels;

const deliveryAliases: Record<string, DeliveryMethod> = {
  delivery: 'delivery',
  배송: 'delivery',
  pickup: 'pickup',
  방문수령: 'pickup',
  courier_rogen: 'courier_rogen',
  '택배-로젠': 'courier_rogen',
  rogen: 'courier_rogen',
  courier_kd_parcel: 'courier_kd_parcel',
  '택배-경동택배': 'courier_kd_parcel',
  '경동택배': 'courier_kd_parcel',
  courier_kd_freight: 'courier_kd_freight',
  '택배-경동화물': 'courier_kd_freight',
  '경동화물': 'courier_kd_freight',
  quick: 'quick',
  퀵: 'quick'
};

export function parseDeliveryMethod(input: string): DeliveryMethod | null {
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }

  return deliveryAliases[normalized] ?? deliveryAliases[normalized.toLowerCase()] ?? null;
}

export function getDeliveryRemark(method: DeliveryMethod): string {
  return deliveryMethodLabels[method];
}

