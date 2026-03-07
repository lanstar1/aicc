import type { FastifyInstance } from 'fastify';

import { env } from '../../config/env';
import type {
  EcountDocumentLineInput,
  SaveQuotationInput,
  SaveSaleInput
} from '../../integrations/ecount/types';
import { getDeliveryRemark } from '../../lib/delivery';
import { createHttpError } from '../../lib/http';

type DraftHeaderRow = {
  id: string;
  customer_id: string | null;
  draft_kind: 'sale' | 'quote';
  warehouse_code: string;
  shipping_method:
    | 'delivery'
    | 'pickup'
    | 'courier_rogen'
    | 'courier_kd_parcel'
    | 'courier_kd_freight'
    | 'quick'
    | null;
  remark_text: string | null;
  prepayment_required: boolean;
  prepayment_notice_sent: boolean;
  total_amount: number | null;
  status: string;
  customer_code: string | null;
  customer_name: string | null;
};

type DraftLineRow = {
  product_code: string;
  product_name: string;
  matched_model_name: string | null;
  qty: number | string;
  unit_price: number | null;
  supply_amount: number | null;
  vat_amount: number | null;
  notes: string | null;
};

export async function saveDraftToEcount(
  app: FastifyInstance,
  draftId: string,
  kind: 'sale' | 'quote'
) {
  const draft = await loadDraft(app, draftId, kind);

  if (kind === 'sale') {
    const saleInput: SaveSaleInput = {
      customerCode: draft.customerCode,
      warehouseCode: draft.header.warehouse_code,
      lines: draft.lines.map((line) =>
        buildDraftLineInput(line, draft.remarkText, draft.prepaymentRemark)
      )
    };

    if (env.ERP_EMP_CD) {
      saleInput.employeeCode = env.ERP_EMP_CD;
    }

    if (draft.customerName) {
      saleInput.customerName = draft.customerName;
    }

    const result = await app.ecount.saveSale(saleInput);
    await markDraftSaved(app, draftId, result.slipNumbers[0] ?? null);
    return result;
  }

  const quotationInput: SaveQuotationInput = {
    customerCode: draft.customerCode,
    warehouseCode: draft.header.warehouse_code,
    lines: draft.lines.map((line) =>
      buildDraftLineInput(line, draft.remarkText, draft.prepaymentRemark)
    )
  };

  if (env.ERP_EMP_CD) {
    quotationInput.employeeCode = env.ERP_EMP_CD;
  }

  if (draft.customerName) {
    quotationInput.customerName = draft.customerName;
  }

  const result = await app.ecount.saveQuotation(quotationInput);
  await markDraftSaved(app, draftId, result.slipNumbers[0] ?? null);
  return result;
}

async function markDraftSaved(
  app: FastifyInstance,
  draftId: string,
  slipNo: string | null
) {
  await app.db.query(
    `
      update aicc.order_draft
      set status = 'erp_saved', erp_slip_no = $2, erp_saved_at = now()
      where id = $1
    `,
    [draftId, slipNo]
  );
}

async function loadDraft(
  app: FastifyInstance,
  draftId: string,
  kind: 'sale' | 'quote'
) {
  const headerResult = await app.db.query<DraftHeaderRow>(
    `
      select
        od.id,
        od.customer_id,
        od.draft_kind,
        od.warehouse_code,
        od.shipping_method,
        od.remark_text,
        od.prepayment_required,
        od.prepayment_notice_sent,
        od.total_amount,
        od.status,
        mc.customer_code,
        mc.customer_name
      from aicc.order_draft od
      left join aicc.master_customer mc on mc.id = od.customer_id
      where od.id = $1
    `,
    [draftId]
  );

  const header = headerResult.rows[0];

  if (!header) {
    throw createHttpError(404, 'Order draft not found');
  }

  if (header.draft_kind !== kind) {
    throw createHttpError(400, `Draft kind mismatch: expected ${kind}`);
  }

  if (!header.customer_code) {
    throw createHttpError(400, 'Draft is missing ERP customer code');
  }

  const lineResult = await app.db.query<DraftLineRow>(
    `
      select
        product_code,
        product_name,
        matched_model_name,
        qty,
        unit_price,
        supply_amount,
        vat_amount,
        notes
      from aicc.order_draft_line
      where order_draft_id = $1
      order by created_at asc
    `,
    [draftId]
  );

  if (lineResult.rows.length === 0) {
    throw createHttpError(400, 'Draft has no line items');
  }

  const remarkText =
    header.remark_text ??
    (header.shipping_method ? getDeliveryRemark(header.shipping_method) : '');

  return {
    header,
    customerCode: header.customer_code,
    customerName: header.customer_name,
    remarkText,
    prepaymentRemark:
      header.prepayment_required || header.prepayment_notice_sent ? '선결제 안내 완료' : '',
    lines: lineResult.rows
  };
}

function buildDraftLineInput(
  line: DraftLineRow,
  remarkText: string,
  prepaymentRemark: string
): EcountDocumentLineInput {
  const input: EcountDocumentLineInput = {
    productCode: line.product_code,
    qty: Number(line.qty)
  };

  if (line.product_name) {
    input.productName = line.product_name;
  }

  if (line.matched_model_name) {
    input.sizeDescription = line.matched_model_name;
  }

  if (line.unit_price !== null) {
    input.unitPrice = line.unit_price;
  }

  if (line.supply_amount !== null) {
    input.supplyAmount = line.supply_amount;
  }

  if (line.vat_amount !== null) {
    input.vatAmount = line.vat_amount;
  }

  if (remarkText) {
    input.remarks = remarkText;
  }

  if (prepaymentRemark) {
    input.pRemarks1 = prepaymentRemark;
  }

  return input;
}
