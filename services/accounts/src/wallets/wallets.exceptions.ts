import { HttpStatus } from '@nestjs/common';
import { AppException, ResponseCode, ResponseMessage } from '@paynad/shared';

/**
 * The idempotency key has never moved money on this wallet. A 404 rather than
 * an empty 200: the caller is asking whether a movement exists, and "no" is an
 * answer about a resource, not a payload.
 */
export class MovementNotFoundException extends AppException {
  constructor(payload: unknown = null) {
    super(
      ResponseCode.TRANSACTION_NOT_FOUND,
      ResponseMessage.TRANSACTION_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      payload,
    );
  }
}
