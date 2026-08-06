import type pg from 'pg';

/** Accepts either the pool or a checked-out client inside a transaction. */
export type Queryable = pg.Pool | pg.PoolClient;

/** TIMESTAMPTZ arrives as a Date; AppState uses ISO-8601 strings. */
export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isoOrUndefined(value: Date | string | null): string | undefined {
  return value === null ? undefined : iso(value);
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const group = map.get(key(item));
    if (group) group.push(item);
    else map.set(key(item), [item]);
  }
  return map;
}
