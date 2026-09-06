import { ApiProperty } from '@nestjs/swagger';

/** One faulty field, as listed in `data` of a VALIDATION_FAILED response. */
export class FieldErrorDto {
  @ApiProperty({ example: 'amount' })
  readonly field: string;

  @ApiProperty({ example: ['amount must be a multiple of 5'], isArray: true, type: String })
  readonly errors: string[];

  constructor(field: string, errors: string[]) {
    this.field = field;
    this.errors = errors;
  }
}
