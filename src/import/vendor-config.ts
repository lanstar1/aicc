export type ProductSource = 'erp' | 'lanstar_file' | 'vendor_sheet' | 'vendor_excel';

export type WorkbookLocation =
  | {
      kind: 'file';
      path: string;
    }
  | {
      kind: 'url';
      url: string;
    };

export type VendorSheetConfig = {
  sheetName: string;
  headerRow: number;
  firstDataRow: number;
  itemCodeCol: string | null;
  modelCol: string | null;
  productNameCol: string | null;
  specCol: string | null;
  dealerPriceCol: string | null;
  onlinePriceCol: string | null;
  guidePriceCol: string | null;
  shippingPolicy: string | null;
  active: boolean;
  notes: string | null;
};

export type VendorWorkbookConfig = {
  brand: string;
  sourceName: string;
  productSource: ProductSource;
  location: WorkbookLocation;
  sheets: VendorSheetConfig[];
};

