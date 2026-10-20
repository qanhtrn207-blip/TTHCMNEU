import { Socket } from 'socket.io';
import { Request } from 'express';

export const ALLOWED_HOST_IPS = [
  '192.168.50.117',
  '127.0.0.1',
  '::1',
  'localhost',
];

export const HOST_PASSCODE = '12092211'; // Secret PIN for host if connecting through tunnels or proxies

export function extractClientIp(reqOrSocket: Request | Socket): string {
  let ip = '';

  if ('headers' in reqOrSocket && 'ip' in reqOrSocket) {
    // Express Request
    const req = reqOrSocket as Request;
    const cfIp = req.headers['cf-connecting-ip'] as string;
    const xForwarded = req.headers['x-forwarded-for'] as string;
    const xReal = req.headers['x-real-ip'] as string;

    if (cfIp) ip = cfIp;
    else if (xForwarded) ip = xForwarded.split(',')[0].trim();
    else if (xReal) ip = xReal;
    else ip = req.ip || req.socket?.remoteAddress || '';
  } else {
    // Socket.IO Socket
    const socket = reqOrSocket as Socket;
    const cfIp = socket.handshake.headers['cf-connecting-ip'] as string;
    const xForwarded = socket.handshake.headers['x-forwarded-for'] as string;
    const xReal = socket.handshake.headers['x-real-ip'] as string;

    if (cfIp) ip = cfIp;
    else if (xForwarded) ip = xForwarded.split(',')[0].trim();
    else if (xReal) ip = xReal;
    else ip = socket.handshake.address || '';
  }

  // Normalize IPv6 mapped IPv4 e.g. ::ffff:192.168.50.117 -> 192.168.50.117
  let normalized = ip.trim();
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.substring(7);
  }
  if (normalized === '::1') {
    normalized = '127.0.0.1';
  }

  return normalized;
}

export function isAuthorizedHost(ip: string, passcode?: string): { allowed: boolean; reason?: string } {
  const normalized = ip.trim();

  // 1. Check exact IP match (192.168.50.117 or localhost)
  if (ALLOWED_HOST_IPS.includes(normalized)) {
    return { allowed: true };
  }

  // 2. Check passcode (for tunnels e.g. trycloudflare.com)
  if (passcode && passcode.trim() === HOST_PASSCODE) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Chỉ thiết bị chủ tọa (IP: 192.168.50.117) mới có quyền tạo và quản lý phòng chơi. IP của bạn (${normalized || 'Không xác định'}) chỉ có quyền tham gia với tư cách người chơi.`,
  };
}
