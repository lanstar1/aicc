import type { FastifyPluginAsync } from 'fastify';

const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sources', async () => {
    const result = await app.db.query(
      `
        select brand, source_name, sheet_name, header_row, first_data_row, guide_price_col, active
        from aicc.vendor_sheet_catalog
        order by brand asc, source_name asc, sheet_name asc
      `
    );

    return {
      items: result.rows
    };
  });
};

export default metaRoutes;

