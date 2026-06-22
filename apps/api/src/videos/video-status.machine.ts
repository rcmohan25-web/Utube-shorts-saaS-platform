import { NotFoundException } from '@nestjs/common';
import { VideoStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';

// Per §20.2: every transition is explicit and centralised. Workers and controllers
// call transitionVideo() — nobody does prisma.video.update({ data: { status } }) directly.
const VALID_TRANSITIONS: Record<VideoStatus, VideoStatus[]> = {
  PENDING: [VideoStatus.DOWNLOADING],
  DOWNLOADING: [VideoStatus.DOWNLOADED, VideoStatus.FAILED],
  DOWNLOADED: [VideoStatus.TRANSCRIBING],
  TRANSCRIBING: [VideoStatus.READY, VideoStatus.FAILED],
  READY: [], // terminal — clip/short state changes happen on other tables from here
  FAILED: [VideoStatus.PENDING], // reprocess
};

export async function transitionVideo(
  prisma: PrismaService,
  videoId: string,
  organizationId: string,
  to: VideoStatus,
  meta: Record<string, unknown> = {},
) {
  const video = await prisma.client.video.findFirst({
    where: { id: videoId, organizationId },
  });
  if (!video) throw new NotFoundException('Video not found');

  if (!VALID_TRANSITIONS[video.status].includes(to)) {
    throw new Error(`Invalid transition ${video.status} -> ${to} for video ${videoId}`);
  }

  return prisma.client.video.update({
    where: { id: videoId },
    data: { status: to, ...meta, updatedAt: new Date() },
  });
}
