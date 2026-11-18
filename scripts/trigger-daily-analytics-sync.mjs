import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const apiDist = new URL('../apps/api/dist/', import.meta.url);
process.chdir(fileURLToPath(new URL('../apps/api/', import.meta.url)));
const require = createRequire(new URL('main.js', apiDist));
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(fileURLToPath(new URL('app.module.js', apiDist)));
const { AnalyticsService } = require(fileURLToPath(new URL('analytics/analytics.service.js', apiDist)));

const app = await NestFactory.createApplicationContext(AppModule);

try {
	const analytics = app.get(AnalyticsService);
	await analytics.dailySyncAllPublished();
	console.log('Triggered dailySyncAllPublished()');
} finally {
	await app.close();
}

process.exit(0);