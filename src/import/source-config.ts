import { env } from '../config/env';
import type { VendorWorkbookConfig } from './vendor-config';
import { isHttpSource } from './source-reader';

export const importSources = {
  customersXlsx: env.IMPORT_CUSTOMERS_XLSX ?? '/Users/lanstar/Downloads/AI-CC/거래처.xlsx',
  lanstarProductsXlsx:
    env.IMPORT_LANSTAR_PRODUCTS_XLSX ?? '/Users/lanstar/Downloads/AI-CC/품목_LANstar.xlsx',
  domesticProductsXlsx:
    env.IMPORT_DOMESTIC_PRODUCTS_XLSX ?? '/Users/lanstar/Downloads/AI-CC/품목_내수.xlsx',
  mergedTechJson: env.IMPORT_MERGED_TECH_JSON ?? '/Users/lanstar/Downloads/AI-CC/기술문의.json',
  rawQnaJson:
    env.IMPORT_RAW_QNA_JSON ?? '/Users/lanstar/Downloads/lanstar_qna_result_20260211_1113.json',
  talkOrderJson:
    env.IMPORT_TALK_ORDER_JSON ?? '/Users/lanstar/Downloads/talk_order_data_20260209_1645.json',
  nexiXlsx:
    env.IMPORT_NEXI_XLSX ??
    '/Users/lanstar/Downloads/NEXI 대리점가격표-2026.02.25 단가인하.xlsx'
};

export const vendorWorkbookConfigs: VendorWorkbookConfig[] = [
  {
    brand: 'ipTIME',
    sourceName: 'vendor_iptime_google',
    productSource: 'vendor_sheet',
    location: {
      kind: 'url',
      url:
        env.IMPORT_IPTIME_URL ??
        'https://docs.google.com/spreadsheets/d/1zTUfre_PJ93ToY--kJA33xSVWf58NTP9YIQSRnvZLMg/edit?usp=sharing'
    },
    sheets: [
      {
        sheetName: '시트1',
        headerRow: 4,
        firstDataRow: 6,
        itemCodeCol: 'B',
        modelCol: 'B',
        productNameCol: 'B',
        specCol: null,
        dealerPriceCol: 'D',
        onlinePriceCol: 'G',
        guidePriceCol: 'G',
        shippingPolicy: '무료배송',
        active: true,
        notes: 'ipTIME 견적가는 G열 무료배송 기준'
      }
    ]
  },
  {
    brand: 'NEXT',
    sourceName: 'vendor_next_google',
    productSource: 'vendor_sheet',
    location: {
      kind: 'url',
      url:
        env.IMPORT_NEXT_URL ??
        'https://docs.google.com/spreadsheets/d/1Vn73xaNhX1hvTtZDed5suY6qoVz1rKABxbiI0FVG55E/edit?usp=sharing'
    },
    sheets: [
      {
        sheetName: '2026년 2월 25일 단가표배포 총판용',
        headerRow: 6,
        firstDataRow: 7,
        itemCodeCol: 'B',
        modelCol: 'F',
        productNameCol: 'F',
        specCol: null,
        dealerPriceCol: 'N',
        onlinePriceCol: 'I',
        guidePriceCol: 'I',
        shippingPolicy: '무료배송',
        active: true,
        notes: 'NEXT 메인 단가표, 무료배송 기준'
      },
      {
        sheetName: '2026년 2월 25일 가격인하',
        headerRow: 6,
        firstDataRow: 7,
        itemCodeCol: 'B',
        modelCol: 'D',
        productNameCol: 'D',
        specCol: null,
        dealerPriceCol: 'M',
        onlinePriceCol: 'H',
        guidePriceCol: 'H',
        shippingPolicy: '무료배송',
        active: true,
        notes: 'NEXT 가격인하 시트, 무료배송 기준'
      },
      {
        sheetName: '2026년 2월 25일 가격인상',
        headerRow: 6,
        firstDataRow: 7,
        itemCodeCol: 'B',
        modelCol: 'D',
        productNameCol: 'D',
        specCol: null,
        dealerPriceCol: 'M',
        onlinePriceCol: 'H',
        guidePriceCol: 'H',
        shippingPolicy: '무료배송',
        active: true,
        notes: 'NEXT 가격인상 시트, 무료배송 기준'
      },
      {
        sheetName: '2026년 2월 25일 신제품',
        headerRow: 6,
        firstDataRow: 7,
        itemCodeCol: 'B',
        modelCol: 'D',
        productNameCol: 'D',
        specCol: null,
        dealerPriceCol: 'M',
        onlinePriceCol: 'H',
        guidePriceCol: 'H',
        shippingPolicy: '무료배송',
        active: true,
        notes: 'NEXT 신제품 시트, 무료배송 기준'
      }
    ]
  },
  {
    brand: 'NEXI',
    sourceName: 'vendor_nexi_excel',
    productSource: 'vendor_excel',
    location: toWorkbookLocation(importSources.nexiXlsx),
    sheets: [
      {
        sheetName: '단가표시트',
        headerRow: 1,
        firstDataRow: 4,
        itemCodeCol: 'A',
        modelCol: 'B',
        productNameCol: 'C',
        specCol: 'H',
        dealerPriceCol: 'D',
        onlinePriceCol: 'E',
        guidePriceCol: 'E',
        shippingPolicy: null,
        active: true,
        notes: 'NEXI 견적가는 온라인등록가 기준'
      }
    ]
  }
];

function toWorkbookLocation(source: string) {
  return isHttpSource(source)
    ? {
        kind: 'url' as const,
        url: source
      }
    : {
        kind: 'file' as const,
        path: source
      };
}
