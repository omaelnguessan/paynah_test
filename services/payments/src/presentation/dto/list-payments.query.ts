import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches, ValidateIf } from 'class-validator';
import { PaginationQueryDto, ReferencePrefix, referencePattern } from '@paynad/shared';
import { PaymentStatus } from '../../domain/model/payment-status';

export class ListPaymentsRequestQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsEnum(PaymentStatus, {
    message: `status must be one of: ${Object.values(PaymentStatus).join(', ')}`,
  })
  status?: PaymentStatus | null;

  @ApiPropertyOptional({ example: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(referencePattern(ReferencePrefix.WALLET), {
    message: 'source_wallet_reference must be a valid reference prefixed with "wlt_"',
  })
  source_wallet_reference?: string | null;
}
