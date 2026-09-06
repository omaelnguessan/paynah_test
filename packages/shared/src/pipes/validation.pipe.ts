import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { FieldErrorDto } from '../dto/validation-error.dto';
import { ValidationFailedException } from '../exceptions/app.exception';

function flatten(errors: ValidationError[], parent = ''): FieldErrorDto[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [new FieldErrorDto(path, Object.values(error.constraints))]
      : [];
    const nested = error.children?.length ? flatten(error.children, path) : [];
    return [...own, ...nested];
  });
}

/**
 * Strict pipe for the whole platform: unknown properties are rejected rather
 * than silently dropped, and failures surface as a VALIDATION_FAILED envelope
 * listing every faulty field in `data`.
 */
export function createValidationPipe(options: ValidationPipeOptions = {}): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new ValidationFailedException(flatten(errors)),
    ...options,
  });
}
