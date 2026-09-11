import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';

/** The `set()` of an Express application, without importing the platform here. */
interface ExpressLike {
  set(setting: string, value: unknown): unknown;
}

export interface HardeningOptions {
  /**
   * Swagger UI needs inline styles and scripts, so the content policy is only
   * relaxed on a service that actually serves the documentation.
   */
  docsEnabled: boolean;
  /** Largest body accepted. Payloads here are flat and small by contract. */
  bodyLimit?: string;
  /** Comma-separated list of allowed origins. Empty means: no browser origin. */
  corsOrigins?: string | null;
  /**
   * Trusted reverse-proxy count or address range.
   * Unset by default; overly broad trust permits spoofing X-Forwarded-For.
   */
  trustProxy?: string | null;
}

/** Shared HTTP headers, body limits and CORS configuration. */
export function applyHttpHardening(app: INestApplication, options: HardeningOptions): void {
  const limit = options.bodyLimit ?? '64kb';
  const express = app as unknown as ExpressLike;


  express.set('x-powered-by', false);
  if (options.trustProxy) {
    const hops = Number(options.trustProxy);
    express.set('trust proxy', Number.isFinite(hops) ? hops : options.trustProxy);
  }

  app.use(
    helmet({
      contentSecurityPolicy: options.docsEnabled ? false : undefined,
      // The API is not a page: framing and referrers have no meaning here.
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(json({ limit }));
  app.use(urlencoded({ extended: false, limit }));

  const origins = (options.corsOrigins ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  // CORS stays off unless an origin is named: a service-to-service API has no
  // reason to be reachable from someone else's page.
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['content-type', 'x-correlation-id'],
      credentials: false,
      maxAge: 600,
    });
  }
}
