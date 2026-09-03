import { Module } from '@nestjs/common';
import { AgencyService } from './agency.service';
import { AgencyController } from './agency.controller';

@Module({
  providers: [AgencyService],
  controllers: [AgencyController],
})
export class AgencyModule {}
