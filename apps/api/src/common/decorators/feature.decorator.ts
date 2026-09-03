import { SetMetadata } from '@nestjs/common';
import type { FeatureFlagName } from '@shorts/shared';

export const FEATURE_KEY = 'feature';

// @Feature('API_ACCESS') on a controller or route.
export const Feature = (flag: FeatureFlagName) => SetMetadata(FEATURE_KEY, flag);
