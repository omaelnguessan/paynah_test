import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiResponse } from '../dto/api-response.dto';
import { ResponseCode } from '../enums/response-code.enum';
import { ResponseMessage } from '../enums/response-message.enum';
import { AppException } from '../exceptions/app.exception';

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

interface RequestLike {
  method: string;
  url: string;
}

/**
 * Last line of defence: nothing leaves the process outside the envelope,
 * whatever threw — a domain exception, a Nest HttpException, or an unknown error.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<ResponseLike>();
    const request = http.getRequest<RequestLike>();

    const { status, body } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${body.message}`);
    }

    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ApiResponse<unknown> } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        body: ApiResponse.of(exception.code, exception.responseMessage, exception.payload ?? null),
      };
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        body: ApiResponse.of(
          this.codeForHttpStatus(exception.getStatus()),
          this.messageForHttpStatus(exception.getStatus()),
          null,
        ),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: ApiResponse.of(ResponseCode.INTERNAL_ERROR, ResponseMessage.INTERNAL_ERROR, null),
    };
  }

  /** Maps framework failures to generic API codes while preserving the HTTP status. */
  private codeForHttpStatus(status: number): string {
    return status >= HttpStatus.INTERNAL_SERVER_ERROR
      ? ResponseCode.INTERNAL_ERROR
      : ResponseCode.VALIDATION_FAILED;
  }

  private messageForHttpStatus(status: number): ResponseMessage {
    return status >= HttpStatus.INTERNAL_SERVER_ERROR
      ? ResponseMessage.INTERNAL_ERROR
      : ResponseMessage.VALIDATION_FAILED;
  }
}
