import { plainToInstance } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

/**
 * Fail fast on a misconfigured container: the process refuses to boot rather
 * than starting with a half-defined upstream URL.
 */
export class EnvConfig {
  @IsString()
  @IsNotEmpty()
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3003;

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_USER: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @IsString()
  @IsNotEmpty()
  RABBITMQ_URL: string;

  @IsString()
  @IsNotEmpty()
  ACCOUNTS_SERVICE_URL: string;

  @IsString()
  @MinLength(16)
  INTERNAL_API_KEY: string;

  @IsString()
  @MinLength(32)
  INTERNAL_API_SECRET: string;

  @IsInt()
  @Min(100)
  HTTP_TIMEOUT_MS: number = 3000;

  @IsInt()
  @Min(0)
  @Max(10)
  HTTP_MAX_RETRIES: number = 2;
}

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const config = plainToInstance(EnvConfig, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment for the payments service:\n  ${details}`);
  }
  return config;
}
