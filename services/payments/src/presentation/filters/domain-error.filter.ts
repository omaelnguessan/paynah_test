import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { ApiResponse, ResponseCode, ResponseMessage, ResponseCodeValue } from '@paynad/shared';
import { DomainError } from '../../domain/errors/domain.error';

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

interface Mapping {
  status: HttpStatus;
  code: ResponseCodeValue;
  message: ResponseMessage;
}

/**
 * The only place that knows a domain failure has an HTTP shape.
 *
 * The domain raises `InsufficientBalanceError`; deciding that this is a 422
 * carrying `"4001"` is a presentation concern, and keeping the decision here is
 * what lets the domain stay ignorant of HTTP.
 */
const MAPPINGS: Readonly<Record<string, Mapping>> = {
  INSUFFICIENT_BALANCE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ResponseCode.INSUFFICIENT_BALANCE,
    message: ResponseMessage.INSUFFICIENT_BALANCE,
  },
  WALLET_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    code: ResponseCode.WALLET_NOT_FOUND,
    message: ResponseMessage.WALLET_NOT_FOUND,
  },
  WALLET_FROZEN: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ResponseCode.WALLET_FROZEN,
    message: ResponseMessage.WALLET_FROZEN,
  },
  CURRENCY_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ResponseCode.CURRENCY_MISMATCH,
    message: ResponseMessage.CURRENCY_MISMATCH,
  },
  SAME_WALLET: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ResponseCode.VALIDATION_FAILED,
    message: ResponseMessage.VALIDATION_FAILED,
  },
  PAYMENT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    code: ResponseCode.TRANSACTION_NOT_FOUND,
    message: ResponseMessage.TRANSACTION_NOT_FOUND,
  },
  IDEMPOTENCY_CONFLICT: {
    status: HttpStatus.CONFLICT,
    code: ResponseCode.IDEMPOTENCY_CONFLICT,
    message: ResponseMessage.IDEMPOTENCY_CONFLICT,
  },
  REQUEST_IN_PROGRESS: {
    status: HttpStatus.CONFLICT,
    code: ResponseCode.DUPLICATE_TRANSACTION,
    message: ResponseMessage.DUPLICATE_TRANSACTION,
  },
  ACCOUNTS_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: ResponseCode.UPSTREAM_UNAVAILABLE,
    message: ResponseMessage.UPSTREAM_UNAVAILABLE,
  },
  PAYMENT_CONFLICT: {
    status: HttpStatus.CONFLICT,
    code: ResponseCode.DUPLICATE_TRANSACTION,
    message: ResponseMessage.DUPLICATE_TRANSACTION,
  },
  INVALID_TRANSITION: {
    status: HttpStatus.CONFLICT,
    code: ResponseCode.VALIDATION_FAILED,
    message: ResponseMessage.VALIDATION_FAILED,
  },
};

const FALLBACK: Mapping = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: ResponseCode.INTERNAL_ERROR,
  message: ResponseMessage.INTERNAL_ERROR,
};

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    const mapping = MAPPINGS[error.code] ?? FALLBACK;

    if (mapping.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ code: error.code, details: error.details }, error.message);
    } else {
      this.logger.warn({ code: error.code, details: error.details }, error.message);
    }

    response
      .status(mapping.status)
      .json(ApiResponse.of(mapping.code, mapping.message, error.details));
  }
}
