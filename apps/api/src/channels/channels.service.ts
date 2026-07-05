import { Injectable, NotFoundException } from '@nestjs/common';
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
    return this.prisma.client.channel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Soft-disconnect: keep history/Shorts attached to the channel, just stop
  // routing new pipeline activity to it. Re-running the OAuth connect flow
  // flips isActive back to true (see YoutubeOAuthService.handleCallback).
  async disconnect(id: string, organizationId: string) {
    const channel = await this.prisma.client.channel.findFirst({ where: { id, organizationId } });
    if (!channel) throw new NotFoundException('Channel not found');

    return this.prisma.client.channel.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
