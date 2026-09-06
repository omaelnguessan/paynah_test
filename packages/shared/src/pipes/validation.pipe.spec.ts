import { ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';
import 'reflect-metadata';
import {
  IsAmount,
  IsCurrency,
  IsSafeDescription,
  IsTransactionId,
} from '../decorators';
import { FieldErrorDto } from '../dto/validation-error.dto';
import { ValidationFailedException } from '../exceptions/app.exception';
import { createValidationPipe } from './validation.pipe';

class CreatePaymentDto {
  @IsTransactionId()
  transaction_id: string;

  @IsAmount()
  amount: number;

  @IsCurrency()
  currency: string;

  @IsSafeDescription()
  description?: string | null;

  @Type(() => Number)
  @IsInt()
  attempt: number;
}

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreatePaymentDto,
  data: '',
};

const pipe = createValidationPipe();

const valid = {
  transaction_id: '9f1c2b7e-4d10-4f2a-9a4c-8f7d3c2b1a05',
  amount: 5000,
  currency: 'XOF',
  description: 'Paiement facture avril',
  attempt: 1,
};

async function failuresOf(payload: Record<string, unknown>): Promise<FieldErrorDto[]> {
  try {
    await pipe.transform(payload, metadata);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationFailedException);
    return (error as ValidationFailedException).payload as FieldErrorDto[];
  }
  throw new Error('expected validation to fail');
}

describe('createValidationPipe', () => {
  it('accepts a well-formed flat snake_case payload', async () => {
    await expect(pipe.transform({ ...valid }, metadata)).resolves.toMatchObject(valid);
  });

  it('accepts an explicit null on an optional field', async () => {
    await expect(
      pipe.transform({ ...valid, description: null }, metadata),
    ).resolves.toMatchObject({ description: null });
  });

  it('accepts an absent optional field', async () => {
    const { description: _omitted, ...withoutDescription } = valid;
    await expect(pipe.transform(withoutDescription, metadata)).resolves.toBeDefined();
  });

  it('lists every faulty field rather than stopping at the first', async () => {
    const failures = await failuresOf({
      transaction_id: 'short',
      amount: 7,
      currency: 'EUR',
      description: 'invalid # char',
      attempt: 1,
    });
    expect(failures.map((failure) => failure.field).sort()).toEqual([
      'amount',
      'currency',
      'description',
      'transaction_id',
    ]);
    expect(failures.every((failure) => failure.errors.length > 0)).toBe(true);
  });

  it.each([10.5, '5000', 3, -5])('rejects %p as an amount', async (amount) => {
    const failures = await failuresOf({ ...valid, amount });
    expect(failures.map((failure) => failure.field)).toContain('amount');
  });

  it.each(['a # b', 'a / b', 'a $ b', 'a _ b', 'a & b'])(
    'refuses %p in a description',
    async (description) => {
      const failures = await failuresOf({ ...valid, description });
      expect(failures.map((failure) => failure.field)).toContain('description');
    },
  );

  it('rejects unknown properties instead of silently dropping them', async () => {
    const failures = await failuresOf({ ...valid, sneaky_field: 'x' });
    expect(failures.map((failure) => failure.field)).toContain('sneaky_field');
  });
});
