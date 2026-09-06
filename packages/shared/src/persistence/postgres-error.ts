/** Postgres SQLSTATE codes the domain reacts to. */
export const PG_UNIQUE_VIOLATION = '23505';

interface DriverError {
  code?: string;
  constraint?: string;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const driverError = error as DriverError | undefined;
  if (driverError?.code !== PG_UNIQUE_VIOLATION) {
    return false;
  }
  return constraint === undefined || driverError.constraint === constraint;
}
