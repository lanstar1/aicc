import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { normalizeWhitespace } from '../../lib/normalize';

const searchProductsQuerySchema = z.object({
  q: z.string().trim().min(1),
  brand: z.string().trim().min(1).optional(),
  customerType: z.enum(['existing', 'new']).default('existing'),
  preferLanstar: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

type ProductSearchRow = {
  id: string;
  brand: string;
  item_code: string;
  product_name: string;
  model_name: string | null;
  dealer_price: number | null;
  online_price: number | null;
  guide_price: number | null;
  is_lanstar: boolean;
  shipping_policy: string | null;
  raw_source_name: string | null;
  score: number;
};

const productRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', async (request) => {
    const query = searchProductsQuerySchema.parse(request.query);
    const q = normalizeWhitespace(query.q);
    const brandLike = query.brand ? `%${query.brand.trim()}%` : null;
    const qLike = `%${q}%`;

    const result = await app.db.query<ProductSearchRow>(
      `
        select
          id,
          brand,
          item_code,
          product_name,
          model_name,
          dealer_price,
          online_price,
          guide_price,
          is_lanstar,
          shipping_policy,
          raw_source_name,
          (
            case
              when $2::boolean is true and is_lanstar then 25
              else 0
            end
            +
            case
              when $3::text is not null and brand ilike $4 then 15
              else 0
            end
            +
            case
              when coalesce(model_name, '') ilike $5 then 20
              else 0
            end
            +
            similarity(search_text, $1) * 20
          ) as score
        from aicc.master_product
        where
          is_active = true
          and ($3::text is null or brand ilike $4)
          and (
            search_text ilike $5
            or product_name ilike $5
            or coalesce(model_name, '') ilike $5
          )
        order by score desc, guide_price nulls last, product_name asc
        limit $6
      `,
      [q, query.preferLanstar, query.brand ?? null, brandLike, qLike, query.limit]
    );

    return {
      items: result.rows.map((row) => {
        const recommendedPrice =
          row.is_lanstar && query.customerType === 'existing'
            ? row.dealer_price ?? row.guide_price
            : row.is_lanstar && query.customerType === 'new'
              ? row.online_price ?? row.guide_price
              : row.guide_price ?? row.online_price ?? row.dealer_price;

        return {
          ...row,
          recommended_price: recommendedPrice
        };
      })
    };
  });
};

export default productRoutes;
