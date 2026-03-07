import type { PoolClient } from 'pg';

import { chunkArray } from './utils';

type SqlValue = string | number | boolean | Date | null;

export async function insertMany(
  client: PoolClient,
  tableName: string,
  columns: string[],
  rows: SqlValue[][],
  options?: {
    onConflict?: string;
  }
) {
  if (rows.length === 0) {
    return;
  }

  for (const chunk of chunkArray(rows, 250)) {
    const values: SqlValue[] = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const rowPlaceholders = row.map((value, columnIndex) => {
        values.push(value);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });

      return `(${rowPlaceholders.join(', ')})`;
    });

    const conflictClause = options?.onConflict ? ` ${options.onConflict}` : '';

    await client.query(
      `insert into ${tableName} (${columns.join(', ')}) values ${placeholders.join(', ')}${conflictClause}`,
      values
    );
  }
}

