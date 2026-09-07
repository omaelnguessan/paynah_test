import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 100;
/**
 * A page number is not free: PostgreSQL still walks the rows an OFFSET skips.
 * Deep paging is capped rather than left as a cheap way to make the database
 * work hard; a caller that far in wants a filter, not page 900 000.
 */
export const MAX_PAGE = 10_000;

/** Flat, snake_case query contract shared by every paginated endpoint. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1, nullable: true })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  @IsOptional()
  page?: number | null;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PER_PAGE,
    default: DEFAULT_PER_PAGE,
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PER_PAGE)
  @IsOptional()
  per_page?: number | null;
}

/**
 * `has_next` rather than a page count: it is the only thing a caller needs to
 * keep paging, and it stays correct while rows are being appended underneath.
 */
export class PaginatedData<T> {
  @ApiProperty({ isArray: true })
  readonly items: T[];

  @ApiProperty({ example: 1 })
  readonly page: number;

  @ApiProperty({ example: DEFAULT_PER_PAGE })
  readonly per_page: number;

  @ApiProperty({ example: 137 })
  readonly total: number;

  @ApiProperty({ example: true })
  readonly has_next: boolean;

  constructor(items: T[], page: number, perPage: number, total: number) {
    this.items = items;
    this.page = page;
    this.per_page = perPage;
    this.total = total;
    this.has_next = page * perPage < total;
  }
}

export interface ResolvedPagination {
  page: number;
  perPage: number;
  skip: number;
}

export function resolvePagination(query: PaginationQueryDto): ResolvedPagination {
  const page = query.page ?? 1;
  const perPage = query.per_page ?? DEFAULT_PER_PAGE;
  return { page, perPage, skip: (page - 1) * perPage };
}
