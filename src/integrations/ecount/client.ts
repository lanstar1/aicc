import { env } from '../../config/env';
import { EcountApiError, type EcountInventoryRow, type EcountProduct, type SaveDocumentResult, type SaveQuotationInput, type SaveSaleInput, type SessionInfo, type ZoneInfo } from './types';

type JsonRecord = Record<string, unknown>;

type EcountEnvelope<TData = unknown> = {
  Status?: string | number | null;
  Error?: {
    Code?: string | number | null;
    Message?: string | null;
    MessageDetail?: string | null;
  } | null;
  Errors?: Array<{
    Code?: string | number | null;
    Message?: string | null;
    MessageDetail?: string | null;
  }> | null;
  Data?: TData | null;
};

type ZoneData = {
  ZONE?: string;
  DOMAIN?: string;
  EXPIRE_DATE?: string;
};

type LoginData = {
  Datas?: {
    SESSION_ID?: string;
    COM_CODE?: string;
    USER_ID?: string;
  };
};

type ProductsData = {
  Result?: JsonRecord[];
};

type InventoryData = {
  Result?: JsonRecord[];
  TRACE_ID?: string;
};

type SaveResultData = {
  SuccessCnt?: string | number;
  FailCnt?: string | number;
  ResultDetails?: string | null;
  SlipNos?: string | null;
  TRACE_ID?: string | null;
};

export class EcountClient {
  private cachedZone: ZoneInfo | null = null;
  private cachedSession: SessionInfo | null = null;
  private zonePromise: Promise<ZoneInfo> | null = null;
  private sessionPromise: Promise<SessionInfo> | null = null;

  async getZoneInfo(): Promise<ZoneInfo> {
    if (this.cachedZone) {
      return this.cachedZone;
    }

    if (this.zonePromise) {
      return this.zonePromise;
    }

    this.zonePromise = this.fetchZoneInfo();

    try {
      this.cachedZone = await this.zonePromise;
      return this.cachedZone;
    } finally {
      this.zonePromise = null;
    }
  }

  async getSessionInfo(forceRefresh = false): Promise<SessionInfo> {
    const now = Date.now();

    if (!forceRefresh && this.cachedSession && this.cachedSession.expiresAt > now + 30_000) {
      return this.cachedSession;
    }

    if (!forceRefresh && this.sessionPromise) {
      return this.sessionPromise;
    }

    this.sessionPromise = this.fetchSessionInfo();

    try {
      this.cachedSession = await this.sessionPromise;
      return this.cachedSession;
    } finally {
      this.sessionPromise = null;
    }
  }

  async getProducts(productCodes: string[]): Promise<EcountProduct[]> {
    const filteredCodes = productCodes.map((code) => code.trim()).filter(Boolean);

    if (filteredCodes.length === 0) {
      return [];
    }

    const payload = await this.request<ProductsData>(
      '/OAPI/V2/InventoryBasic/GetBasicProductsList',
      {
        PROD_CD: filteredCodes.join('∬'),
        COMMA_FLAG: filteredCodes.some((code) => code.includes(',')) ? 'Y' : 'N'
      }
    );

    return (payload.Result ?? []).map((row) => ({
      productCode: toStringValue(row.PROD_CD) ?? '',
      productName: toStringValue(row.PROD_DES) ?? '',
      sizeDescription: toStringValue(row.SIZE_DES),
      unit: toStringValue(row.UNIT),
      outPrice: toNumberValue(row.OUT_PRICE),
      outPrice1: toNumberValue(row.OUT_PRICE1),
      outPrice2: toNumberValue(row.OUT_PRICE2),
      remarks: toStringValue(row.REMARKS),
      raw: row
    }));
  }

  async getInventoryByLocation(input: {
    productCode: string;
    warehouseCode?: string;
    baseDate?: string;
  }): Promise<EcountInventoryRow[]> {
    const payload = await this.request<InventoryData>(
      '/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatusByLocation',
      {
        PROD_CD: input.productCode,
        WH_CD: input.warehouseCode ?? '',
        BASE_DATE: input.baseDate ?? formatEcountDate(new Date())
      }
    );

    return (payload.Result ?? []).map((row) => ({
      warehouseCode: toStringValue(row.WH_CD) ?? '',
      warehouseName: toStringValue(row.WH_DES) ?? '',
      productCode: toStringValue(row.PROD_CD) ?? '',
      productName: toStringValue(row.PROD_DES) ?? '',
      productSizeDescription: toStringValue(row.PROD_SIZE_DES),
      balanceQuantity: toNumberValue(row.BAL_QTY),
      raw: row
    }));
  }

  async saveSale(input: SaveSaleInput): Promise<SaveDocumentResult> {
    const saleList = input.lines.map((line) => ({
      BulkDatas: {
        IO_DATE: input.ioDate ?? formatEcountDate(new Date()),
        UPLOAD_SER_NO: '1',
        CUST: input.customerCode,
        CUST_DES: input.customerName ?? '',
        EMP_CD: input.employeeCode ?? '',
        WH_CD: input.warehouseCode,
        IO_TYPE: input.ioType ?? env.ERP_IO_TYPE ?? '',
        SITE: input.site ?? env.ERP_SITE ?? '',
        PJT_CD: input.projectCode ?? env.ERP_PJT_CD ?? '',
        TTL_CTT: input.title ?? '',
        PROD_CD: line.productCode,
        PROD_DES: line.productName ?? '',
        SIZE_DES: line.sizeDescription ?? '',
        QTY: String(line.qty),
        PRICE: line.unitPrice !== undefined ? String(line.unitPrice) : '',
        SUPPLY_AMT: line.supplyAmount !== undefined ? String(line.supplyAmount) : '',
        VAT_AMT: line.vatAmount !== undefined ? String(line.vatAmount) : '',
        REMARKS: line.remarks ?? '',
        P_REMARKS1: line.pRemarks1 ?? '',
        P_REMARKS2: line.pRemarks2 ?? '',
        P_REMARKS3: line.pRemarks3 ?? ''
      }
    }));

    const payload = await this.request<SaveResultData>('/OAPI/V2/Sale/SaveSale', {
      SaleList: saleList
    });

    return mapSaveResult(payload);
  }

  async saveQuotation(input: SaveQuotationInput): Promise<SaveDocumentResult> {
    const quotationList = input.lines.map((line) => ({
      BulkDatas: {
        IO_DATE: input.ioDate ?? formatEcountDate(new Date()),
        UPLOAD_SER_NO: '1',
        CUST: input.customerCode,
        CUST_DES: input.customerName ?? '',
        EMP_CD: input.employeeCode ?? '',
        WH_CD: input.warehouseCode,
        IO_TYPE: input.ioType ?? env.ERP_IO_TYPE ?? '',
        PJT_CD: input.projectCode ?? env.ERP_PJT_CD ?? '',
        REF_DES: input.referenceDescription ?? '',
        COLL_TERM: input.collectionTerm ?? '',
        AGREE_TERM: input.agreementTerm ?? '',
        TTL_CTT: input.title ?? '',
        PROD_CD: line.productCode,
        PROD_DES: line.productName ?? '',
        SIZE_DES: line.sizeDescription ?? '',
        QTY: String(line.qty),
        PRICE: line.unitPrice !== undefined ? String(line.unitPrice) : '',
        SUPPLY_AMT: line.supplyAmount !== undefined ? String(line.supplyAmount) : '',
        VAT_AMT: line.vatAmount !== undefined ? String(line.vatAmount) : '',
        REMARKS: line.remarks ?? '',
        P_REMARKS1: line.pRemarks1 ?? '',
        P_REMARKS2: line.pRemarks2 ?? '',
        P_REMARKS3: line.pRemarks3 ?? ''
      }
    }));

    const payload = await this.request<SaveResultData>('/OAPI/V2/Quotation/SaveQuotation', {
      QuotationList: quotationList
    });

    return mapSaveResult(payload);
  }

  private async fetchZoneInfo(): Promise<ZoneInfo> {
    const payload = await this.requestWithoutSession<ZoneData>('/OAPI/V2/Zone', {
      COM_CODE: requiredEnv('ERP_COM_CODE')
    });

    const zone = toStringValue(payload.ZONE);

    if (!zone) {
      throw new EcountApiError({
        message: 'ECOUNT zone not found',
        payload
      });
    }

    return {
      zone,
      domain: toStringValue(payload.DOMAIN),
      expireDate: toStringValue(payload.EXPIRE_DATE)
    };
  }

  private async fetchSessionInfo(): Promise<SessionInfo> {
    const zoneInfo = await this.getZoneInfo();
    const payload = await this.requestWithoutSession<LoginData>(
      '/OAPI/V2/OAPILogin',
      {
        COM_CODE: requiredEnv('ERP_COM_CODE'),
        USER_ID: requiredEnv('ERP_USER_ID'),
        API_CERT_KEY: requiredEnv('ERP_API_CERT_KEY'),
        LAN_TYPE: env.ERP_LAN_TYPE,
        ZONE: zoneInfo.zone
      },
      zoneInfo.zone
    );

    const sessionId = toStringValue(payload.Datas?.SESSION_ID);

    if (!sessionId) {
      throw new EcountApiError({
        message: 'ECOUNT session ID missing',
        payload
      });
    }

    return {
      zone: zoneInfo.zone,
      sessionId,
      expiresAt: Date.now() + env.ERP_SESSION_TTL_SECONDS * 1000
    };
  }

  private async request<TData>(path: string, body: JsonRecord): Promise<TData> {
    try {
      const session = await this.getSessionInfo();
      return await this.requestWithSession<TData>(path, body, session.zone, session.sessionId);
    } catch (error) {
      if (isSessionTimeoutError(error)) {
        this.cachedSession = null;
        const refreshedSession = await this.getSessionInfo(true);
        return this.requestWithSession<TData>(path, body, refreshedSession.zone, refreshedSession.sessionId);
      }

      throw error;
    }
  }

  private async requestWithSession<TData>(
    path: string,
    body: JsonRecord,
    zone: string,
    sessionId: string
  ): Promise<TData> {
    const url = new URL(path, `${this.getZoneBaseUrl(zone)}/`);
    url.searchParams.set('SESSION_ID', sessionId);

    return this.execute<TData>(url.toString(), body);
  }

  private async requestWithoutSession<TData>(
    path: string,
    body: JsonRecord,
    zone?: string
  ): Promise<TData> {
    const base = zone ? this.getZoneBaseUrl(zone) : this.getRootBaseUrl();
    const url = new URL(path, `${base}/`);
    return this.execute<TData>(url.toString(), body);
  }

  private async execute<TData>(url: string, body: JsonRecord): Promise<TData> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new EcountApiError({
        message: `ECOUNT request failed with HTTP ${response.status}`,
        status: response.status
      });
    }

    const payload = (await response.json()) as EcountEnvelope<TData>;
    const status = payload.Status ?? null;
    const error = payload.Error ?? payload.Errors?.[0] ?? null;

    if (error || String(status) !== '200') {
      throw new EcountApiError({
        code: error?.Code ?? null,
        message: error?.Message ?? `ECOUNT request failed with status ${String(status)}`,
        messageDetail: error?.MessageDetail ?? null,
        status,
        payload
      });
    }

    if (payload.Data === null || payload.Data === undefined) {
      throw new EcountApiError({
        message: 'ECOUNT response data missing',
        status,
        payload
      });
    }

    return payload.Data;
  }

  private getRootBaseUrl(): string {
    const base = env.ERP_BASE_URL ?? 'https://oapi.ecount.com';
    return base.replace(/\/+$/, '');
  }

  private getZoneBaseUrl(zone: string): string {
    const root = new URL(this.getRootBaseUrl());
    root.hostname = root.hostname.replace(/^oapi[^.]*/i, `oapi${zone.toLowerCase()}`);
    return root.toString().replace(/\/$/, '');
  }
}

function mapSaveResult(payload: SaveResultData): SaveDocumentResult {
  return {
    successCount: Number(payload.SuccessCnt ?? 0),
    failCount: Number(payload.FailCnt ?? 0),
    resultDetails: toStringValue(payload.ResultDetails),
    slipNumbers: splitSlipNumbers(payload.SlipNos),
    traceId: toStringValue(payload.TRACE_ID),
    raw: payload as JsonRecord
  };
}

function splitSlipNumbers(value: unknown): string[] {
  const text = toStringValue(value);

  if (!text) {
    return [];
  }

  return text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function toStringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = toStringValue(value);

  if (!text) {
    return null;
  }

  const numeric = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function requiredEnv(key: 'ERP_COM_CODE' | 'ERP_USER_ID' | 'ERP_API_CERT_KEY'): string {
  const value = env[key];

  if (!value) {
    throw new Error(`${key} is required for ECOUNT integration`);
  }

  return value;
}

function isSessionTimeoutError(error: unknown): boolean {
  return (
    error instanceof EcountApiError &&
    /session timeout/i.test(`${error.message} ${error.messageDetail ?? ''}`)
  );
}

function formatEcountDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

