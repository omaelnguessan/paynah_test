import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse as SwaggerResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiResponse } from '../dto/api-response.dto';
import { ResponseMessage } from '../enums/response-message.enum';

interface EnvelopeOptions<T> {
  status: number;
  code: string;
  message: ResponseMessage;
  description?: string;
  model?: Type<T>;
  isArray?: boolean;
}

function envelopeSchema<T>(options: EnvelopeOptions<T>): Record<string, unknown> {
  const dataSchema = options.model
    ? options.isArray
      ? { type: 'array', items: { $ref: getSchemaPath(options.model) } }
      : { $ref: getSchemaPath(options.model) }
    : { nullable: true, example: null };

  return {
    allOf: [
      { $ref: getSchemaPath(ApiResponse) },
      {
        properties: {
          code: { type: 'string', example: options.code },
          message: { type: 'string', enum: [options.message] },
          data: dataSchema,
        },
      },
    ],
  };
}

/** Documents a route response while keeping the single envelope visible in Swagger. */
export function ApiEnvelopeResponse<T>(options: EnvelopeOptions<T>): MethodDecorator {
  const models = options.model ? [ApiResponse, options.model] : [ApiResponse];
  return applyDecorators(
    ApiExtraModels(...models),
    SwaggerResponse({
      status: options.status,
      description: options.description ?? options.message,
      schema: envelopeSchema(options),
    }),
  );
}
