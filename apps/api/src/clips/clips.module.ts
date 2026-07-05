import { Module } from '@nestjs/common';
import { ClipsService } from './clips.service';
import { ClipsController } from './clips.controller';
import { WebsocketsModule } from '../websockets/websockets.module';

@Module({
  imports: [WebsocketsModule],
  providers: [ClipsService],
  controllers: [ClipsController],
  exports: [ClipsService],
})
export class ClipsModule {}
