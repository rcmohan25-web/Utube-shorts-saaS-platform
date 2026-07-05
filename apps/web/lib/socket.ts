'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth-store';

// Strip the /api/v1 suffix — Socket.IO connects to the bare server origin,
// not a REST path.
const SOCKET_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(
  /\/api\/v1\/?$/,
  '',
);

let socket: Socket | null = null;

// Lazily creates a single shared socket, authenticated with the current
// access token. Org room join happens server-side on connect (§8.3).
export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    auth: { token: getAccessToken() },
    autoConnect: true,
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
