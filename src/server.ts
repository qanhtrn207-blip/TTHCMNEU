import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GameEngine } from './game/GameEngine.js';
import { registerSocketHandlers } from './sockets/socketHandler.js';
import { QuizSet } from './types/game.js';
import { extractClientIp, isAuthorizedHost } from './utils/ipCheck.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Trust reverse proxies (Cloudflare, Nginx, LAN)
app.set('trust proxy', true);

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })
);

app.use(express.json({ limit: '10mb' }));

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

const engine = new GameEngine();
registerSocketHandlers(io, engine);

// --- REST API ---

// 1. Health check & Client Info
app.get('/api/health', (req: Request, res: Response) => {
  const clientIp = extractClientIp(req);
  const auth = isAuthorizedHost(clientIp);

  res.json({
    status: 'ok',
    game: 'MAZE RUSH',
    clientIp,
    isHostAllowed: auth.allowed,
    timestamp: new Date().toISOString(),
  });
});

// 2. Check Host Permission
app.get('/api/host-permission', (req: Request, res: Response) => {
  const clientIp = extractClientIp(req);
  const passcode = req.query.passcode as string | undefined;
  const auth = isAuthorizedHost(clientIp, passcode);

  res.json({
    clientIp,
    isHostAllowed: auth.allowed,
    reason: auth.reason,
    allowedIps: ['192.168.50.117', '127.0.0.1'],
  });
});

// 3. Quiz sets
app.get('/api/quiz-sets', (req: Request, res: Response) => {
  res.json(engine.getQuizSets());
});

app.get('/api/quiz-sets/:id', (req: Request, res: Response) => {
  const quiz = engine.getQuizSetById(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz set not found' });
  }
  res.json(quiz);
});

app.post('/api/quiz-sets', (req: Request, res: Response) => {
  const data = req.body as Partial<QuizSet>;
  if (!data.title || !data.questions || !Array.isArray(data.questions)) {
    return res.status(400).json({ error: 'Tiêu đề và danh sách câu hỏi là bắt buộc' });
  }

  const newQuizSet: QuizSet = {
    id: data.id || `custom_quiz_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: data.title,
    description: data.description || '',
    questions: data.questions,
    ownerName: data.ownerName || 'Giáo viên',
    createdAt: new Date().toISOString(),
  };

  engine.saveQuizSet(newQuizSet);
  res.status(201).json(newQuizSet);
});

app.put('/api/quiz-sets/:id', (req: Request, res: Response) => {
  const existing = engine.getQuizSetById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Quiz set not found' });
  }

  const updated: QuizSet = {
    ...existing,
    ...req.body,
    id: req.params.id,
  };

  engine.saveQuizSet(updated);
  res.json(updated);
});

app.delete('/api/quiz-sets/:id', (req: Request, res: Response) => {
  const success = engine.deleteQuizSet(req.params.id);
  if (!success) {
    return res
      .status(400)
      .json({ error: 'Không thể xóa bộ câu hỏi mặc định của hệ thống.' });
  }
  res.json({ success: true });
});

// 4. Room details by code
app.get('/api/rooms/:code', (req: Request, res: Response) => {
  const room = engine.getRoomByCode(req.params.code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    id: room.id,
    code: room.code,
    name: room.name,
    hostName: room.hostName,
    status: room.status,
    playerCount: Object.keys(room.players).length,
    maxPlayers: room.settings.maxPlayers,
    quizTitle: room.quizTitle,
    difficulty: room.settings.difficulty,
  });
});

// 5. Export CSV Leaderboard for Teachers
app.get('/api/rooms/:roomId/export-csv', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const room = engine.getRoomById(roomId);
  if (!room) {
    return res.status(404).send('Phòng không tồn tại');
  }

  const leaderboard = engine.getLeaderboard(roomId);
  const rows = [
    ['Hạng', 'Nickname', 'Trạng thái', 'Điểm số', 'Câu đúng', 'Câu sai', 'Tiến độ (%)', 'Vật phẩm đã dùng', 'Danh hiệu'],
  ];

  leaderboard.forEach((entry) => {
    rows.push([
      entry.rank.toString(),
      `"${entry.nickname.replace(/"/g, '""')}"`,
      entry.isFinished
        ? 'Đã về đích'
        : `Cách đích ${entry.distanceToFinish ?? 0} ô (${entry.progress}%)`,
      entry.score.toString(),
      entry.correctCount.toString(),
      entry.wrongCount.toString(),
      `${entry.progress}%`,
      entry.itemsUsedCount.toString(),
      `"${(entry.badge || '').replace(/"/g, '""')}"`,
    ]);
  });

  const csvContent = '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n'); // Add UTF-8 BOM for Excel compatibility

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="maze-rush-${room.code}-results.csv"`
  );
  res.send(csvContent);
});

// 6. Serve static client build (Single-port deployment support)
const possiblePaths = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
  path.resolve(__dirname, '../../client/dist'),
];
const clientDistPath = possiblePaths.find((p) => fs.existsSync(p));

if (clientDistPath) {
  app.use(express.static(clientDistPath));
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`🚀 MAZE RUSH Server running on port ${PORT}`);
  console.log(`👉 API Health: http://localhost:${PORT}/api/health`);
  console.log(`👉 Host IP Permission: Only 192.168.50.117 & localhost allowed to host`);
  console.log(`🎮 Socket.IO listening for multiplayer connections`);
});
