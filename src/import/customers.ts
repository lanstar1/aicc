import type { PoolClient } from 'pg';

import type { CustomerSeed } from './types';
import { insertMany } from './db';
import { getSourceUpdatedAt } from './source-reader';
import { cleanCell, inferYongsanArea, normalizeCustomerName, normalizeDigits, parseMoney } from './utils';
import { getSheetRows, loadWorkbook } from './workbook';

export async function loadCustomerSeeds(source: string): Promise<CustomerSeed[]> {
  const [workbook, sourceUpdatedAt] = await Promise.all([
    loadWorkbook(toWorkbookLocation(source)),
    getSourceUpdatedAt(source)
  ]);
  const [sheetName] = workbook.SheetNames;

  if (!sheetName) {
    throw new Error('Customer workbook has no sheets');
  }

  const rows = getSheetRows(workbook, sheetName);
  const dataRows = rows.slice(1);
  const seeds: CustomerSeed[] = [];

  for (const row of dataRows) {
    const customerCode = cleanCell(row[0]);
    const customerName = cleanCell(row[1]);

    if (!customerCode || !customerName) {
      continue;
    }

    const address1 = cleanCell(row[4]);
    const depositNote = cleanCell(row[7]);

    seeds.push({
      customerCode,
      customerName,
      customerNameNormalized: normalizeCustomerName(customerName),
      ceoName: cleanCell(row[2]),
      phone: cleanCell(row[3]),
      phoneDigits: normalizeDigits(cleanCell(row[3])),
      mobile: cleanCell(row[5]),
      mobileDigits: normalizeDigits(cleanCell(row[5])),
      address1,
      isYongsanArea: inferYongsanArea(address1),
      depositRequired: Boolean(depositNote),
      depositNote,
      creditLimit: parseMoney(row[6]),
      sourceUpdatedAt
    });
  }

  return seeds;
}

export async function upsertCustomers(client: PoolClient, seeds: CustomerSeed[]) {
  await insertMany(
    client,
    'aicc.master_customer',
    [
      'customer_code',
      'customer_name',
      'customer_name_normalized',
      'ceo_name',
      'phone',
      'phone_digits',
      'mobile',
      'mobile_digits',
      'address1',
      'is_yongsan_area',
      'deposit_required',
      'deposit_note',
      'credit_limit',
      'source_updated_at'
    ],
    seeds.map((seed) => [
      seed.customerCode,
      seed.customerName,
      seed.customerNameNormalized,
      seed.ceoName,
      seed.phone,
      seed.phoneDigits,
      seed.mobile,
      seed.mobileDigits,
      seed.address1,
      seed.isYongsanArea,
      seed.depositRequired,
      seed.depositNote,
      seed.creditLimit,
      seed.sourceUpdatedAt
    ]),
    {
      onConflict: `
        on conflict (customer_code) do update set
          customer_name = excluded.customer_name,
          customer_name_normalized = excluded.customer_name_normalized,
          ceo_name = excluded.ceo_name,
          phone = excluded.phone,
          phone_digits = excluded.phone_digits,
          mobile = excluded.mobile,
          mobile_digits = excluded.mobile_digits,
          address1 = excluded.address1,
          is_yongsan_area = excluded.is_yongsan_area,
          deposit_required = excluded.deposit_required,
          deposit_note = excluded.deposit_note,
          credit_limit = excluded.credit_limit,
          source_updated_at = excluded.source_updated_at,
          updated_at = now()
      `
    }
  );
}

function toWorkbookLocation(source: string) {
  return /^https?:\/\//i.test(source)
    ? {
        kind: 'url' as const,
        url: source
      }
    : {
        kind: 'file' as const,
        path: source
      };
}
