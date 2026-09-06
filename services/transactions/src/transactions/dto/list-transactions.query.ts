import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches, ValidateIf } from 'class-validator';
import {
  PaginationQueryDto,
  ReferencePrefix,
  TransactionType,
  referencePattern,
} from '@paynad/shared';

export class ListTransactionsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(referencePattern(ReferencePrefix.USER), {
    message: 'user_reference must be a valid reference prefixed with "usr_"',
  })
  user_reference?: string | null;

  @ApiPropertyOptional({ example: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(referencePattern(ReferencePrefix.WALLET), {
    message: 'wallet_reference must be a valid reference prefixed with "wlt_"',
  })
  wallet_reference?: string | null;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsEnum(TransactionType, {
    message: `type must be one of: ${Object.values(TransactionType).join(', ')}`,
  })
  type?: TransactionType | null;
}
