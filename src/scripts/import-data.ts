import { parseArgs } from 'node:util';

import { Pool } from 'pg';

import { env } from '../config/env';
import { loadCustomerSeeds, upsertCustomers } from '../import/customers';
import { importSources } from '../import/source-config';
import {
  loadDomesticProductSeeds,
  loadLanstarProductSeeds,
  loadVendorWorkbookSeeds,
  replaceProductsForSource,
  replaceVendorCatalogs
} from '../import/products';
import { loadTechSeeds, replaceTechData } from '../import/tech';
import type { ImportSummary } from '../import/types';

async function main() {
  const args = parseArgs({
    options: {
      'dry-run': {
        type: 'boolean',
        default: false
      }
    }
  });

  const dryRun = args.values['dry-run'];
  const summary: ImportSummary = {
    customers: 0,
    products: 0,
    vendorCatalogs: 0,
    techModels: 0,
    techChunks: 0
  };

  console.log('[import] loading customer workbook');
  const customerSeeds = await loadCustomerSeeds(importSources.customersXlsx);
  summary.customers = customerSeeds.length;

  console.log('[import] loading LANstar products');
  const lanstarProductSeeds = await loadLanstarProductSeeds(importSources.lanstarProductsXlsx);

  console.log('[import] loading domestic products');
  const domesticProductSeeds = await loadDomesticProductSeeds(importSources.domesticProductsXlsx);

  console.log('[import] loading vendor workbooks');
  const vendorSeeds = await loadVendorWorkbookSeeds();

  summary.products =
    lanstarProductSeeds.length + domesticProductSeeds.length + vendorSeeds.products.length;
  summary.vendorCatalogs = vendorSeeds.catalogs.length;

  console.log('[import] loading tech data');
  const techSeeds = await loadTechSeeds({
    mergedTechJson: importSources.mergedTechJson,
    rawQnaJson: importSources.rawQnaJson,
    talkOrderJson: importSources.talkOrderJson
  });
  summary.techModels = techSeeds.models.length;
  summary.techChunks = techSeeds.chunks.length;

  console.log('[import] summary', summary);

  if (dryRun) {
    console.log('[import] dry-run complete');
    return;
  }

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined
  });

  try {
    const client = await pool.connect();

    try {
      console.log('[import] upserting customers');
      await client.query('begin');
      await upsertCustomers(client, customerSeeds);
      await client.query('commit');

      console.log('[import] replacing products: LANstar');
      await client.query('begin');
      await replaceProductsForSource(client, 'products_lanstar_excel', lanstarProductSeeds);
      await client.query('commit');

      console.log('[import] replacing products: domestic');
      await client.query('begin');
      await replaceProductsForSource(client, 'products_domestic_excel', domesticProductSeeds);
      await client.query('commit');

      console.log('[import] replacing vendor catalogs and products');
      await client.query('begin');
      await replaceVendorCatalogs(client, vendorSeeds.catalogs);
      const vendorSourceNames = Array.from(new Set(vendorSeeds.products.map((product) => product.rawSourceName)));

      for (const rawSourceName of vendorSourceNames) {
        await replaceProductsForSource(
          client,
          rawSourceName,
          vendorSeeds.products.filter((product) => product.rawSourceName === rawSourceName)
        );
      }
      await client.query('commit');

      console.log('[import] replacing tech data');
      await client.query('begin');
      await replaceTechData(client, techSeeds);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log('[import] complete');
}

void main();
