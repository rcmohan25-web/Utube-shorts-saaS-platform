import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Thin wrapper so PrismaClient participates in Nest's lifecycle hooks.
const prisma = globalThis.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
