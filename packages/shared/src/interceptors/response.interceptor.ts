import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse, isApiResponse } from '../dto/api-response.dto';

interface ResponseLike {
  statusCode: number;
}

/**
 * Wraps every successful handler return value into the single response
 * envelope. A handler that already built an `ApiResponse` is passed through,
 * so a controller can pick its own applicative code when it needs to.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const response = context.switchToHttp().getResponse<ResponseLike>();

    return next.handle().pipe(
      map((payload): ApiResponse<T> => {
        if (isApiResponse(payload)) {
          return payload as ApiResponse<T>;
        }
        const body = (payload ?? null) as T | null;
        return response.statusCode === HttpStatus.CREATED
          ? ApiResponse.created<T>(body)
          : ApiResponse.ok<T>(body);
      }),
    );
  }
}
