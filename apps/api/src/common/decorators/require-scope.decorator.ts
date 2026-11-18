import { SetMetadata } from '@nestjs/common';
import type { ApiKeyScope } from '@shorts/db';

export const REQUIRE_SCOPE_KEY = 'requireApiKeyScope';

// @RequireScope(ApiKeyScope.READ_WRITE) on a public-API route that
// mutates data. Routes without this decorator are callable by any valid,
// non-revoked API key regardless of scope — READ_ONLY is a floor a route
// can raise, never something a route has to opt into for reads.
export const RequireScope = (scope: ApiKeyScope) => SetMetadata(REQUIRE_SCOPE_KEY, scope);
