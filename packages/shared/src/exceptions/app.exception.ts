import { HttpException, HttpStatus } from '@nestjs/common';
import { ResponseCode, ResponseCodeValue } from '../enums/response-code.enum';
import { ResponseMessage } from '../enums/response-message.enum';

/**
 * Base of every domain failure. Carries the applicative code and message
 * independently of the HTTP status, which stays a transport concern.
 */
export class AppException extends HttpException {
  readonly code: string;
  readonly responseMessage: ResponseMessage;
  readonly payload: unknown;

  constructor(
    code: ResponseCodeValue | string,
    responseMessage: ResponseMessage,
    httpStatus: HttpStatus,
    payload: unknown = null,
  ) {
    super(responseMessage, httpStatus);
    this.code = code;
    this.responseMessage = responseMessage;
    this.payload = payload;
  }
}

export class ValidationFailedException extends AppException {
  constructor(payload: unknown) {
    super(
      ResponseCode.VALIDATION_FAILED,
      ResponseMessage.VALIDATION_FAILED,
      HttpStatus.BAD_REQUEST,
      payload,
    );
  }
}

export class UserNotFoundException extends AppException {
  constructor(payload: unknown = null) {
    super(ResponseCode.USER_NOT_FOUND, ResponseMessage.USER_NOT_FOUND, HttpStatus.NOT_FOUND, payload);
  }
}

export class WalletNotFoundException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.WALLET_NOT_FOUND,
      ResponseMessage.WALLET_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      payload,
    );
  }
}

export class TransactionNotFoundException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.TRANSACTION_NOT_FOUND,
      ResponseMessage.TRANSACTION_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      payload,
    );
  }
}

export class WalletFrozenException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.WALLET_FROZEN,
      ResponseMessage.WALLET_FROZEN,
      HttpStatus.UNPROCESSABLE_ENTITY,
      payload,
    );
  }
}

export class InsufficientBalanceException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.INSUFFICIENT_BALANCE,
      ResponseMessage.INSUFFICIENT_BALANCE,
      HttpStatus.UNPROCESSABLE_ENTITY,
      payload,
    );
  }
}

export class CurrencyMismatchException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.CURRENCY_MISMATCH,
      ResponseMessage.CURRENCY_MISMATCH,
      HttpStatus.UNPROCESSABLE_ENTITY,
      payload,
    );
  }
}

/** Same `transaction_id` replayed with an identical body: the caller retried. */
export class DuplicateTransactionException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.DUPLICATE_TRANSACTION,
      ResponseMessage.DUPLICATE_TRANSACTION,
      HttpStatus.CONFLICT,
      payload,
    );
  }
}

/** Same `transaction_id` replayed with a *different* body: the caller is wrong. */
export class IdempotencyConflictException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.IDEMPOTENCY_CONFLICT,
      ResponseMessage.IDEMPOTENCY_CONFLICT,
      HttpStatus.CONFLICT,
      payload,
    );
  }
}

export class UpstreamUnavailableException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.UPSTREAM_UNAVAILABLE,
      ResponseMessage.UPSTREAM_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      payload,
    );
  }
}

export class InternalErrorException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.INTERNAL_ERROR,
      ResponseMessage.INTERNAL_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      payload,
    );
  }
}
