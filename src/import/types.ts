import type { ProductSource } from './vendor-config';

export type CustomerSeed = {
  customerCode: string;
  customerName: string;
  customerNameNormalized: string | null;
  ceoName: string | null;
  phone: string | null;
  phoneDigits: string | null;
  mobile: string | null;
  mobileDigits: string | null;
  address1: string | null;
  isYongsanArea: boolean;
  depositRequired: boolean;
  depositNote: string | null;
  creditLimit: number | null;
  sourceUpdatedAt: Date | null;
};

export type ProductSeed = {
  productSource: ProductSource;
  brand: string;
  itemCode: string;
  productName: string;
  modelName: string | null;
  specText: string | null;
  dealerPrice: number | null;
  onlinePrice: number | null;
  guidePrice: number | null;
  vatIncluded: boolean;
  shippingPolicy: string | null;
  isLanstar: boolean;
  searchText: string;
  rawSourceName: string;
  rawSheetName: string;
  rawRowNo: number | null;
  aliases: string[];
};

export type VendorCatalogSeed = {
  brand: string;
  sourceName: string;
  sheetName: string;
  headerRow: number;
  firstDataRow: number;
  itemCodeCol: string | null;
  modelCol: string | null;
  productNameCol: string | null;
  guidePriceCol: string | null;
  shippingCol: string | null;
  notes: string | null;
  active: boolean;
};

export type TechModelSeed = {
  brand: string;
  modelName: string;
  productName: string;
  category: string | null;
  qnaCount: number;
  searchText: string;
  sourceUpdatedAt: Date | null;
};

export type TechChunkSeed = {
  modelName: string | null;
  sourceType: 'merged_json' | 'raw_qna' | 'talk_data' | 'download_board';
  rawProductName: string | null;
  question: string;
  answer: string;
  searchText: string;
  resolved: boolean | null;
  answerQuality: number | null;
  metadata: Record<string, unknown>;
};

export type ImportSummary = {
  customers: number;
  products: number;
  vendorCatalogs: number;
  techModels: number;
  techChunks: number;
};

