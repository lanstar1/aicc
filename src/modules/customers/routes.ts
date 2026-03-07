import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { normalizeDigits, normalizeWhitespace } from '../../lib/normalize';

const searchCustomersQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(4).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10)
  })
  .refine((value) => Boolean(value.q || value.phone), {
    message: 'Either q or phone is required'
  });

const customerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', async (request) => {
    const query = searchCustomersQuerySchema.parse(request.query);
    const phoneDigits = normalizeDigits(query.phone);
    const q = normalizeWhitespace(query.q);
    const qLike = q ? `%${q}%` : null;

    const result = await app.db.query(
      `
        select
          id,
          customer_code,
          customer_name,
          ceo_name,
          phone,
          mobile,
          address1,
          is_yongsan_area,
          deposit_required,
          deposit_note,
          (
            case
              when $1::text is not null and (phone_digits = $1 or mobile_digits = $1) then 100
              when $1::text is not null and (phone_digits like '%' || $1 || '%' or mobile_digits like '%' || $1 || '%') then 80
              else 0
            end
            +
            case
              when $2::text is not null and customer_name ilike $3 then 40
              else 0
            end
            +
            case
              when $2::text is not null then similarity(customer_name, $2) * 20
              else 0
            end
          ) as score
        from aicc.master_customer
        where
          ($1::text is not null and (phone_digits like '%' || $1 || '%' or mobile_digits like '%' || $1 || '%'))
          or
          ($2::text is not null and (customer_name ilike $3 or coalesce(customer_name_normalized, '') ilike $3))
        order by score desc, customer_name asc
        limit $4
      `,
      [phoneDigits, q, qLike, query.limit]
    );

    return {
      items: result.rows
    };
  });
};

export default customerRoutes;

