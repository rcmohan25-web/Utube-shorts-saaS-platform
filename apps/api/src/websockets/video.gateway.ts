import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { AuthenticatedUserClaims, ClipCreatedEvent, ShortReadyEvent, VideoStatusEvent } from '@shorts/shared';

// Per §8.3: org-scoped rooms so a push for Org A never reaches a socket
// connected from Org B. Auth happens once, at handshake — there's no
// per-message auth on a long-lived socket, so a missing/invalid token gets
// disconnected immediately rather than silently joining no room.
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class VideoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VideoGateway.name);

  constructor(private jwt: JwtService) {}

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const claims = this.jwt.verify<AuthenticatedUserClaims>(token);
      client.join(`org:${claims.orgId}`);
      this.logger.log(`Socket ${client.id} joined org:${claims.orgId}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket ${client.id} disconnected`);
  }

  emitVideoStatus(orgId: string, payload: VideoStatusEvent) {
    this.server.to(`org:${orgId}`).emit('video:status', payload);
  }

  emitClipCreated(orgId: string, payload: ClipCreatedEvent) {
    this.server.to(`org:${orgId}`).emit('clip:created', payload);
  }

  emitShortReady(orgId: string, payload: ShortReadyEvent) {
    this.server.to(`org:${orgId}`).emit('short:ready', payload);
  }
}
