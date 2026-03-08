import type { PoolClient } from 'pg';

import { isHttpSource } from './source-reader';
import { vendorWorkbookConfigs } from './source-config';
import type { ProductSeed, VendorCatalogSeed } from './types';
import type { VendorSheetConfig, VendorWorkbookConfig } from './vendor-config';
import { insertMany } from './db';
import {
  buildProductAliases,
  buildSearchText,
  cleanCell,
  extractBracketBrand,
  parseMoney,
  stripBracketBrand
} from './utils';
import { getCell, getSheetRows, loadWorkbook } from './workbook';

export async function loadLanstarProductSeeds(source: string): Promise<ProductSeed[]> {
  const workbook = await loadWorkbook(toWorkbookLocation(source));
  const [sheetName] = workbook.SheetNames;

  if (!sheetName) {
    throw new Error('LANstar product workbook has no sheets');
  }

  const rows = getSheetRows(workbook, sheetName).slice(1);
  const seeds: ProductSeed[] = [];

  for (const [index, row] of rows.entries()) {
    const itemCode = cleanCell(row[0]);
    const productName = cleanCell(row[1]);

    if (!itemCode || !productName) {
      continue;
    }

    const modelName = cleanCell(row[2]);
    const dealerPrice = parseMoney(row[3]);
    const onlinePrice = parseMoney(row[4]);
    const aliases = buildProductAliases({
      brand: 'LANstar',
      itemCode,
      productName,
      modelName,
      specText: null
    });

    seeds.push({
      productSource: 'lanstar_file',
      brand: 'LANstar',
      itemCode,
      productName,
      modelName,
      specText: null,
      dealerPrice,
      onlinePrice,
      guidePrice: onlinePrice ?? dealerPrice,
      vatIncluded: true,
      shippingPolicy: null,
      isLanstar: true,
      searchText: buildSearchText(['LANstar', itemCode, productName, modelName, ...aliases]),
      rawSourceName: 'products_lanstar_excel',
      rawSheetName: sheetName,
      rawRowNo: index + 2,
      aliases
    });
  }

  return seeds;
}

export async function loadDomesticProductSeeds(source: string): Promise<ProductSeed[]> {
  const workbook = await loadWorkbook(toWorkbookLocation(source));
  const [sheetName] = workbook.SheetNames;

  if (!sheetName) {
    throw new Error('Domestic product workbook has no sheets');
  }

  const rows = getSheetRows(workbook, sheetName).slice(1);
  const seeds: ProductSeed[] = [];

  for (const [index, row] of rows.entries()) {
    const itemCode = cleanCell(row[0]);
    const productName = cleanCell(row[1]);

    if (!itemCode || !productName || itemCode === '.') {
      continue;
    }

    const modelName = cleanCell(row[2]);
    const dealerPrice = parseMoney(row[3]);
    const onlinePrice = parseMoney(row[4]);
    const inferredBrand = extractBracketBrand(productName) ?? 'UNASSIGNED';
    const cleanedName = stripBracketBrand(productName) ?? productName;
    const aliases = buildProductAliases({
      brand: inferredBrand,
      itemCode,
      productName: cleanedName,
      modelName,
      specText: null
    });

    seeds.push({
      productSource: 'vendor_excel',
      brand: inferredBrand,
      itemCode,
      productName: cleanedName,
      modelName,
      specText: null,
      dealerPrice,
      onlinePrice,
      guidePrice: onlinePrice ?? dealerPrice,
      vatIncluded: true,
      shippingPolicy: null,
      isLanstar: inferredBrand.toLowerCase() === 'lanstar',
      searchText: buildSearchText([inferredBrand, itemCode, cleanedName, modelName, ...aliases]),
      rawSourceName: 'products_domestic_excel',
      rawSheetName: sheetName,
      rawRowNo: index + 2,
      aliases
    });
  }

  return seeds;
}

export async function loadVendorWorkbookSeeds(): Promise<{
  catalogs: VendorCatalogSeed[];
  products: ProductSeed[];
}> {
  const catalogs: VendorCatalogSeed[] = [];
  const products: ProductSeed[] = [];

  for (const config of vendorWorkbookConfigs) {
    const workbook = await loadWorkbook(config.location);

    for (const sheetConfig of config.sheets) {
      catalogs.push(toVendorCatalogSeed(config, sheetConfig));

      const sheetRows = getSheetRows(workbook, sheetConfig.sheetName);
      const dataRows = sheetRows.slice(sheetConfig.firstDataRow - 1);

      for (const [index, row] of dataRows.entries()) {
        const seed = toVendorProductSeed(config, sheetConfig, row, sheetConfig.firstDataRow + index);

        if (seed) {
          products.push(seed);
        }
      }
    }
  }

  return {
    catalogs,
    products
  };
}

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

export async function replaceVendorCatalogs(client: PoolClient, catalogs: VendorCatalogSeed[]) {
  const sourceNames = Array.from(new Set(catalogs.map((catalog) => catalog.sourceName)));

  if (sourceNames.length === 0) {
    return;
  }

  await client.query(`delete from aicc.vendor_sheet_catalog where source_name = any($1::text[])`, [sourceNames]);

  await insertMany(
    client,
    'aicc.vendor_sheet_catalog',
    [
      'brand',
      'source_name',
      'sheet_name',
      'header_row',
      'first_data_row',
      'item_code_col',
      'model_col',
      'product_name_col',
      'guide_price_col',
      'shipping_col',
      'notes',
      'active'
    ],
    catalogs.map((catalog) => [
      catalog.brand,
      catalog.sourceName,
      catalog.sheetName,
      catalog.headerRow,
      catalog.firstDataRow,
      catalog.itemCodeCol,
      catalog.modelCol,
      catalog.productNameCol,
      catalog.guidePriceCol,
      catalog.shippingCol,
      catalog.notes,
      catalog.active
    ])
  );
}

export async function replaceProductsForSource(
  client: PoolClient,
  rawSourceName: string,
  products: ProductSeed[]
) {
  await client.query(
    `
      delete from aicc.product_alias
      where product_id in (
        select id from aicc.master_product where raw_source_name = $1
      )
    `,
    [rawSourceName]
  );

  await client.query(`delete from aicc.master_product where raw_source_name = $1`, [rawSourceName]);

  if (products.length === 0) {
    return;
  }

  await insertMany(
    client,
    'aicc.master_product',
    [
      'product_source',
      'brand',
      'item_code',
      'product_name',
      'model_name',
      'spec_text',
      'dealer_price',
      'online_price',
      'guide_price',
      'vat_included',
      'shipping_policy',
      'is_lanstar',
      'search_text',
      'raw_source_name',
      'raw_sheet_name',
      'raw_row_no',
      'is_active'
    ],
    products.map((product) => [
      product.productSource,
      product.brand,
      product.itemCode,
      product.productName,
      product.modelName,
      product.specText,
      product.dealerPrice,
      product.onlinePrice,
      product.guidePrice,
      product.vatIncluded,
      product.shippingPolicy,
      product.isLanstar,
      product.searchText,
      product.rawSourceName,
      product.rawSheetName,
      product.rawRowNo,
      true
    ])
  );

  const productRows = await client.query<{
    id: string;
    item_code: string;
    raw_sheet_name: string;
  }>(
    `
      select id, item_code, raw_sheet_name
      from aicc.master_product
      where raw_source_name = $1
    `,
    [rawSourceName]
  );

  const productIdByKey = new Map(
    productRows.rows.map((row) => [`${row.item_code}::${row.raw_sheet_name}`, row.id])
  );

  const aliasRows = products.flatMap((product) => {
    const productId = productIdByKey.get(`${product.itemCode}::${product.rawSheetName}`);

    if (!productId) {
      return [];
    }

    return product.aliases.map((alias) => [productId, alias, guessAliasType(alias, product), 1]);
  });

  await insertMany(
    client,
    'aicc.product_alias',
    ['product_id', 'alias_text', 'alias_type', 'confidence'],
    aliasRows,
    {
      onConflict: 'on conflict (product_id, alias_text) do nothing'
    }
  );
}

function toVendorCatalogSeed(
  workbookConfig: VendorWorkbookConfig,
  sheetConfig: VendorSheetConfig
): VendorCatalogSeed {
  return {
    brand: workbookConfig.brand,
    sourceName: workbookConfig.sourceName,
    sheetName: sheetConfig.sheetName,
    headerRow: sheetConfig.headerRow,
    firstDataRow: sheetConfig.firstDataRow,
    itemCodeCol: sheetConfig.itemCodeCol,
    modelCol: sheetConfig.modelCol,
    productNameCol: sheetConfig.productNameCol,
    guidePriceCol: sheetConfig.guidePriceCol,
    shippingCol: sheetConfig.guidePriceCol,
    notes: sheetConfig.notes,
    active: sheetConfig.active
  };
}

function toVendorProductSeed(
  workbookConfig: VendorWorkbookConfig,
  sheetConfig: VendorSheetConfig,
  row: unknown[],
  rawRowNo: number
): ProductSeed | null {
  const itemCode = cleanCell(getCell(row, sheetConfig.itemCodeCol) ?? getCell(row, sheetConfig.modelCol));
  const modelName = cleanCell(getCell(row, sheetConfig.modelCol));
  const productName = cleanCell(getCell(row, sheetConfig.productNameCol) ?? modelName ?? itemCode);

  if (!itemCode || !productName) {
    return null;
  }

  const specText = cleanCell(getCell(row, sheetConfig.specCol));
  const dealerPrice = parseMoney(getCell(row, sheetConfig.dealerPriceCol));
  const onlinePrice = parseMoney(getCell(row, sheetConfig.onlinePriceCol));
  const guidePrice = parseMoney(getCell(row, sheetConfig.guidePriceCol));
  const aliases = buildProductAliases({
    brand: workbookConfig.brand,
    itemCode,
    productName,
    modelName,
    specText
  });

  return {
    productSource: workbookConfig.productSource,
    brand: workbookConfig.brand,
    itemCode,
    productName,
    modelName,
    specText,
    dealerPrice,
    onlinePrice,
    guidePrice: guidePrice ?? onlinePrice ?? dealerPrice,
    vatIncluded: true,
    shippingPolicy: sheetConfig.shippingPolicy,
    isLanstar: workbookConfig.brand.toLowerCase() === 'lanstar',
    searchText: buildSearchText([
      workbookConfig.brand,
      itemCode,
      productName,
      modelName,
      specText,
      ...aliases
    ]),
    rawSourceName: workbookConfig.sourceName,
    rawSheetName: sheetConfig.sheetName,
    rawRowNo,
    aliases
  };
}

function guessAliasType(alias: string, product: ProductSeed): 'product_name' | 'model' | 'spec' | 'manual_alias' {
  if (product.modelName && alias === product.modelName) {
    return 'model';
  }

  if (product.specText && alias === product.specText) {
    return 'spec';
  }

  if (alias === product.productName || alias === stripBracketBrand(product.productName)) {
    return 'product_name';
  }

  return 'manual_alias';
}
