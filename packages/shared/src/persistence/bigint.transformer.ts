/**
 * `bigint` comes back from the pg driver as a string to avoid a silent
 * precision loss. Amounts here are minor units bounded well below
 * `Number.MAX_SAFE_INTEGER`, so the domain keeps them as `number`.
 */
export const bigintTransformer = {
  to: (value: number): number => value,
  from: (value: string | null): number => (value === null ? 0 : Number(value)),
};
