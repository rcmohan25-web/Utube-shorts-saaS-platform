import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateChannelDto, organizationId: string, userId: string) {
    return this.prisma.client.channel.create({
      data: { ...dto, organizationId, userId },
    });
  }

  findAll(organizationId: string) {
    return this.prisma.client.channel.findMany({ where: { organizationId } });
  }
}
