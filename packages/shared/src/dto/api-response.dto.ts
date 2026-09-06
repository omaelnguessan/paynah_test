import { ApiProperty } from '@nestjs/swagger';
import { ResponseCode, ResponseCodeValue } from '../enums/response-code.enum';
import { ResponseMessage } from '../enums/response-message.enum';

/**
 * The one and only shape leaving an HTTP handler — success or failure.
 * `code` is the applicative code as a String, deliberately decoupled from
 * the HTTP status carried by the response line.
 */
export class ApiResponse<T> {
  @ApiProperty({ example: '200', description: 'Applicative code, as a String' })
  readonly code: string;

  @ApiProperty({ enum: ResponseMessage, example: ResponseMessage.SUCCESS })
  readonly message: ResponseMessage;

  @ApiProperty({ nullable: true, description: 'Payload, or null' })
  readonly data: T | null;

  private constructor(code: string, message: ResponseMessage, data: T | null) {
    this.code = code;
    this.message = message;
    this.data = data;
  }

  static ok<T>(data: T | null, code: ResponseCodeValue = ResponseCode.SUCCESS): ApiResponse<T> {
    return new ApiResponse<T>(code, ResponseMessage.SUCCESS, data);
  }

  static created<T>(data: T | null): ApiResponse<T> {
    return new ApiResponse<T>(ResponseCode.CREATED, ResponseMessage.CREATED, data);
  }

  static of<T>(code: string, message: ResponseMessage, data: T | null = null): ApiResponse<T> {
    return new ApiResponse<T>(code, message, data);
  }
}

/** True when a handler already produced the envelope itself. */
export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'data' in value
  );
}
