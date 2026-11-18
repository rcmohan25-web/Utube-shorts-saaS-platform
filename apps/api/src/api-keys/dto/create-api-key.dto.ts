import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiKeyScope } from '@shorts/db';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  // PR 14 (§15.2 follow-up: per-API-key scoping). Optional and defaults
  // to READ_WRITE in ApiKeysService.create() when omitted — this
  // preserves pre-PR-14 behavior (every key could do everything the
  // API_ACCESS-gated routes expose) for any caller of this endpoint that
  // hasn't been updated to pass a scope explicitly.
  @IsOptional()
  @IsIn([ApiKeyScope.READ_ONLY, ApiKeyScope.READ_WRITE])
  scope?: ApiKeyScope;
}
