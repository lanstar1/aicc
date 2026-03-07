import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env';
import { saveDraftToEcount } from './draft-service';
import type {
  EcountDocumentLineInput,
  SaveQuotationInput,
  SaveSaleInput
} from '../../integrations/ecount/types';

const productsQuerySchema = z.object({
  productCodes: z.string().trim().min(1)
});

const inventoryQuerySchema = z.object({
  productCode: z.string().trim().min(1),
  warehouseCode: z.string().trim().optional(),
  baseDate: z.string().regex(/^\d{8}$/).optional()
});

const documentLineSchema = z.object({
  productCode: z.string().trim().min(1),
  productName: z.string().trim().optional(),
  sizeDescription: z.string().trim().optional(),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  supplyAmount: z.coerce.number().nonnegative().optional(),
  vatAmount: z.coerce.number().nonnegative().optional(),
  remarks: z.string().trim().optional(),
  pRemarks1: z.string().trim().optional(),
  pRemarks2: z.string().trim().optional(),
  pRemarks3: z.string().trim().optional()
});

const saveSaleBodySchema = z.object({
  ioDate: z.string().regex(/^\d{8}$/).optional(),
  customerCode: z.string().trim().min(1),
  customerName: z.string().trim().optional(),
  employeeCode: z.string().trim().optional(),
  warehouseCode: z.string().trim().min(1),
  ioType: z.string().trim().optional(),
  site: z.string().trim().optional(),
  projectCode: z.string().trim().optional(),
  title: z.string().trim().optional(),
  lines: z.array(documentLineSchema).min(1)
});

const saveQuotationBodySchema = z.object({
  ioDate: z.string().regex(/^\d{8}$/).optional(),
  customerCode: z.string().trim().min(1),
  customerName: z.string().trim().optional(),
  employeeCode: z.string().trim().optional(),
  warehouseCode: z.string().trim().min(1),
  ioType: z.string().trim().optional(),
  projectCode: z.string().trim().optional(),
  referenceDescription: z.string().trim().optional(),
  collectionTerm: z.string().trim().optional(),
  agreementTerm: z.string().trim().optional(),
  title: z.string().trim().optional(),
  lines: z.array(documentLineSchema).min(1)
});

const erpRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const zone = await app.ecount.getZoneInfo();
    const session = await app.ecount.getSessionInfo();

    return {
      ok: true,
      zone: zone.zone,
      sessionExpiresAt: new Date(session.expiresAt).toISOString()
    };
  });

  app.get('/products', async (request) => {
    const query = productsQuerySchema.parse(request.query);
    const productCodes = query.productCodes
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);

    return {
      items: await app.ecount.getProducts(productCodes)
    };
  });

  app.get('/inventory', async (request) => {
    const query = inventoryQuerySchema.parse(request.query);
    const inventoryInput: {
      productCode: string;
      warehouseCode?: string;
      baseDate?: string;
    } = {
      productCode: query.productCode
    };

    if (query.warehouseCode) {
      inventoryInput.warehouseCode = query.warehouseCode;
    }

    if (query.baseDate) {
      inventoryInput.baseDate = query.baseDate;
    }

    return {
      items: await app.ecount.getInventoryByLocation(inventoryInput)
    };
  });

  app.post('/sales', async (request, reply) => {
    const body = saveSaleBodySchema.parse(request.body);
    const result = await app.ecount.saveSale(buildSaleInput(body));
    return reply.status(201).send(result);
  });

  app.post('/quotations', async (request, reply) => {
    const body = saveQuotationBodySchema.parse(request.body);
    const result = await app.ecount.saveQuotation(buildQuotationInput(body));
    return reply.status(201).send(result);
  });

  app.post('/sales/from-draft/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return saveDraftToEcount(app, params.id, 'sale');
  });

  app.post('/quotations/from-draft/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return saveDraftToEcount(app, params.id, 'quote');
  });
};

function buildSaleInput(body: z.infer<typeof saveSaleBodySchema>): SaveSaleInput {
  const input: SaveSaleInput = {
    customerCode: body.customerCode,
    warehouseCode: body.warehouseCode,
    lines: body.lines.map(buildDocumentLineInput)
  };

  const employeeCode = body.employeeCode ?? env.ERP_EMP_CD;

  if (employeeCode) {
    input.employeeCode = employeeCode;
  }

  if (body.ioDate) {
    input.ioDate = body.ioDate;
  }

  if (body.customerName) {
    input.customerName = body.customerName;
  }

  if (body.ioType) {
    input.ioType = body.ioType;
  }

  if (body.site) {
    input.site = body.site;
  }

  if (body.projectCode) {
    input.projectCode = body.projectCode;
  }

  if (body.title) {
    input.title = body.title;
  }

  return input;
}

function buildQuotationInput(body: z.infer<typeof saveQuotationBodySchema>): SaveQuotationInput {
  const input: SaveQuotationInput = {
    customerCode: body.customerCode,
    warehouseCode: body.warehouseCode,
    lines: body.lines.map(buildDocumentLineInput)
  };

  const employeeCode = body.employeeCode ?? env.ERP_EMP_CD;

  if (employeeCode) {
    input.employeeCode = employeeCode;
  }

  if (body.ioDate) {
    input.ioDate = body.ioDate;
  }

  if (body.customerName) {
    input.customerName = body.customerName;
  }

  if (body.ioType) {
    input.ioType = body.ioType;
  }

  if (body.projectCode) {
    input.projectCode = body.projectCode;
  }

  if (body.referenceDescription) {
    input.referenceDescription = body.referenceDescription;
  }

  if (body.collectionTerm) {
    input.collectionTerm = body.collectionTerm;
  }

  if (body.agreementTerm) {
    input.agreementTerm = body.agreementTerm;
  }

  if (body.title) {
    input.title = body.title;
  }

  return input;
}

function buildDocumentLineInput(
  line: z.infer<typeof documentLineSchema>
): EcountDocumentLineInput {
  const input: EcountDocumentLineInput = {
    productCode: line.productCode,
    qty: line.qty
  };

  if (line.productName) {
    input.productName = line.productName;
  }

  if (line.sizeDescription) {
    input.sizeDescription = line.sizeDescription;
  }

  if (line.unitPrice !== undefined) {
    input.unitPrice = line.unitPrice;
  }

  if (line.supplyAmount !== undefined) {
    input.supplyAmount = line.supplyAmount;
  }

  if (line.vatAmount !== undefined) {
    input.vatAmount = line.vatAmount;
  }

  if (line.remarks) {
    input.remarks = line.remarks;
  }

  if (line.pRemarks1) {
    input.pRemarks1 = line.pRemarks1;
  }

  if (line.pRemarks2) {
    input.pRemarks2 = line.pRemarks2;
  }

  if (line.pRemarks3) {
    input.pRemarks3 = line.pRemarks3;
  }

  return input;
}

export default erpRoutes;
