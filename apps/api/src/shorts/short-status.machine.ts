import { NotFoundException } from '@nestjs/common';
import { ShortStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';

// Per §20.2's pattern, applied to Short — the §20.13 code review checklist
// explicitly calls out transitionShort() alongside transitionVideo() as
// mandatory. Direct `prisma.short.update({ data: { status } })` calls
// elsewhere in the codebase are a review-reject.
//
// RENDERING -> REVIEW/FAILED is intentionally NOT reachable through this
// function: render-worker's callback always *creates* the Short row
// directly at REVIEW or FAILED (the row doesn't exist before that point —
// see ClipsService.approve()'s comment on pre-generating the id). This
// table only governs transitions on a Short that already exists, exactly
// parallel to how Video rows are inserted at PENDING directly and only
// later changes go through transitionVideo().
const VALID_TRANSITIONS: Record<ShortStatus, ShortStatus[]> = {
  RENDERING: [ShortStatus.REVIEW, ShortStatus.FAILED],
  REVIEW: [ShortStatus.APPROVED, ShortStatus.REJECTED],
  APPROVED: [ShortStatus.SCHEDULED], // wired up once the Scheduler PR lands
  SCHEDULED: [ShortStatus.PUBLISHED, ShortStatus.FAILED],
  REJECTED: [ShortStatus.RENDERING], // rerender, via /shorts/:id/rerender (future)
  PUBLISHED: [],
  FAILED: [ShortStatus.RENDERING], // retry
};

export async function transitionShort(
  prisma: PrismaService,
  shortId: string,
  organizationId: string,
  to: ShortStatus,
  meta: Record<string, unknown> = {},
) {
  const short = await prisma.client.short.findFirst({ where: { id: shortId, organizationId } });
  if (!short) throw new NotFoundException('Short not found');

  if (!VALID_TRANSITIONS[short.status].includes(to)) {
    throw new Error(`Invalid transition ${short.status} -> ${to} for short ${shortId}`);
  }

  return prisma.client.short.update({
    where: { id: shortId },
    data: { status: to, ...meta, updatedAt: new Date() },
  });
}
