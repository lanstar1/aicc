export type EcountApiErrorInfo = {
  code?: string | number | null;
  message: string;
  messageDetail?: string | null;
  status?: string | number | null;
  payload?: unknown;
};

export class EcountApiError extends Error {
  code: string | number | null | undefined;
  status: string | number | null | undefined;
  messageDetail: string | null | undefined;
  payload: unknown;

  constructor(info: EcountApiErrorInfo) {
    super(info.message);
    this.name = 'EcountApiError';
    this.code = info.code;
    this.status = info.status;
    this.messageDetail = info.messageDetail;
    this.payload = info.payload;
  }
}

export type ZoneInfo = {
  zone: string;
  domain: string | null;
  expireDate: string | null;
};

export type SessionInfo = {
  zone: string;
  sessionId: string;
  expiresAt: number;
};

export type EcountProduct = {
  productCode: string;
  productName: string;
  sizeDescription: string | null;
  unit: string | null;
  outPrice: number | null;
  outPrice1: number | null;
  outPrice2: number | null;
  remarks: string | null;
  raw: Record<string, unknown>;
};

export type EcountInventoryRow = {
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  productSizeDescription: string | null;
  balanceQuantity: number | null;
  raw: Record<string, unknown>;
};

export type EcountDocumentLineInput = {
  productCode: string;
  productName?: string;
  sizeDescription?: string;
  qty: number;
  unitPrice?: number;
  supplyAmount?: number;
  vatAmount?: number;
  remarks?: string;
  pRemarks1?: string;
  pRemarks2?: string;
  pRemarks3?: string;
};

export type SaveSaleInput = {
  ioDate?: string;
  customerCode: string;
  customerName?: string;
  employeeCode?: string;
  warehouseCode: string;
  ioType?: string;
  site?: string;
  projectCode?: string;
  title?: string;
  lines: EcountDocumentLineInput[];
};

export type SaveQuotationInput = {
  ioDate?: string;
  customerCode: string;
  customerName?: string;
  employeeCode?: string;
  warehouseCode: string;
  ioType?: string;
  projectCode?: string;
  referenceDescription?: string;
  collectionTerm?: string;
  agreementTerm?: string;
  title?: string;
  lines: EcountDocumentLineInput[];
};

export type SaveDocumentResult = {
  successCount: number;
  failCount: number;
  resultDetails: string | null;
  slipNumbers: string[];
  traceId: string | null;
  raw: Record<string, unknown>;
};
