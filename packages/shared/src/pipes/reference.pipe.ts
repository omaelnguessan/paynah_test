import { Injectable, PipeTransform } from '@nestjs/common';
import { referencePattern } from '../constants';
import { FieldErrorDto } from '../dto/validation-error.dto';
import { ReferencePrefix } from '../enums';
import { ValidationFailedException } from '../exceptions/app.exception';

/**
 * Rejects a malformed `:reference` before it ever reaches a query, and keeps
 * "wrong family" (a `usr_` where a `wlt_` is expected) out of the 404 path.
 */
@Injectable()
export class ReferencePipe implements PipeTransform<string, string> {
  private readonly pattern: RegExp;

  constructor(private readonly prefix: ReferencePrefix) {
    this.pattern = referencePattern(prefix);
  }

  transform(value: string): string {
    if (!this.pattern.test(value)) {
      throw new ValidationFailedException([
        new FieldErrorDto('reference', [
          `reference must be a valid reference prefixed with "${this.prefix}_"`,
        ]),
      ]);
    }
    return value;
  }
}
