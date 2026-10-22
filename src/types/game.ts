export type GameMode = 'classic' | 'chaos' | 'knowledge' | 'practice';
export type MazeDifficulty = 'easy' | 'medium' | 'hard';

export enum CellType {
  PATH = 0,
  WALL = 1,
  OBSTACLE_GATE = 2,
  POWERUP_BOX = 3,
  FINISH_GATE = 4,
  START_TILE = 5,
}

export type PowerUpType =
  | 'ice_trap'
  | 'time_attack'
  | 'speed_boost'
  | 'shield'
  | 'reveal_path'
  | 'teleport'
  | 'time_freeze'
  | 'lucky_key';

export interface PowerUpMeta {
  type: PowerUpType;
  name: string;
  nameVi: string;
  description: string;
  targetRequired: boolean;
  durationMs?: number;
  icon: string;
  color: string;
}

export const POWER_UPS: Record<PowerUpType, PowerUpMeta> = {
  ice_trap: {
    type: 'ice_trap',
    name: 'Ice Trap',
    nameVi: 'Bẫy Băng',
    description: 'Làm chậm 50% tốc độ di chuyển của đối thủ trong 5 giây.',
    targetRequired: true,
    durationMs: 5000,
    icon: 'Snowflake',
    color: '#38bdf8',
  },
  time_attack: {
    type: 'time_attack',
    name: 'Time Attack',
    nameVi: 'Ép Thời Gian',
    description: 'Giảm 50% thời gian trả lời câu hỏi tiếp theo của đối thủ.',
    targetRequired: true,
    icon: 'Hourglass',
    color: '#f97316',
  },
  speed_boost: {
    type: 'speed_boost',
    name: 'Speed Boost',
    nameVi: 'Tăng Tốc',
    description: 'Tăng 60% tốc độ di chuyển của bản thân trong 5 giây.',
    targetRequired: false,
    durationMs: 5000,
    icon: 'Zap',
    color: '#eab308',
  },
  shield: {
    type: 'shield',
    name: 'Shield',
    nameVi: 'Khiên Bảo Vệ',
    description: 'Chặn 1 đòn tấn công bất kỳ từ đối thủ.',
    targetRequired: false,
    icon: 'Shield',
    color: '#10b981',
  },
  reveal_path: {
    type: 'reveal_path',
    name: 'Reveal Path',
    nameVi: 'Hé Lộ Đường Đi',
    description: 'Hiển thị đoạn đường ngắn nhất đến vạch đích trong 6 giây.',
    targetRequired: false,
    durationMs: 6000,
    icon: 'Compass',
    color: '#a855f7',
  },
  teleport: {
    type: 'teleport',
    name: 'Teleport',
    nameVi: 'Dịch Chuyển',
    description: 'Dịch chuyển tức thời tiến lên 4-6 bước an toàn về phía đích.',
    targetRequired: false,
    icon: 'Sparkles',
    color: '#06b6d4',
  },
  time_freeze: {
    type: 'time_freeze',
    name: 'Time Freeze',
    nameVi: 'Đóng Băng',
    description: 'Đóng băng đối thủ tại chỗ trong 3 giây.',
    targetRequired: true,
    durationMs: 3000,
    icon: 'Lock',
    color: '#60a5fa',
  },
  lucky_key: {
    type: 'lucky_key',
    name: 'Lucky Key',
    nameVi: 'Chìa Khóa Vàng',
    description: 'Mở ngay chướng ngại vật gần nhất mà không cần giải câu hỏi.',
    targetRequired: false,
    icon: 'Key',
    color: '#fbbf24',
  },
};

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  type: 'multiple_choice';
  content: string;
  options: QuestionOption[];
  correctAnswer?: string;
  explanation?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number;
  rewardType?: string;
}

export interface QuizSet {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
  ownerName?: string;
  createdAt: string;
}

export interface PlayerEffects {
  freezeUntil?: number;
  slowUntil?: number;
  speedUntil?: number;
  shieldActive?: boolean;
  timeAttackActive?: boolean;
  stunnedByNpc?: boolean;
}

export interface Player {
  id: string;
  socketId: string;
  nickname: string;
  avatar: string;
  isHost: boolean;
  x: number;
  y: number;
  progress: number;
  inventory: PowerUpType[];
  activeEffects: PlayerEffects;
  isFinished: boolean;
  finishedAt?: number;
  rank?: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  itemsUsedCount: number;
  attacksAbsorbedCount: number;
  currentObstacleId?: string;
  connected: boolean;
}

export interface MazeNPC {
  id: string;
  name: string;
  x: number;
  y: number;
  type: 'guard' | 'patrol';
  icon: string;
  color: string;
  dx: number;
  dy: number;
}

export interface ObstacleGate {
  id: string;
  x: number;
  y: number;
  questionId: string;
  unlockedBy: string[];
  playerId?: string;
}

export interface PowerUpSpawn {
  id: string;
  x: number;
  y: number;
  type: PowerUpType;
  collectedBy: string[];
}

export interface MazeData {
  width: number;
  height: number;
  grid: number[][];
  startPos: { x: number; y: number };
  finishPos: { x: number; y: number };
  obstacleGates: ObstacleGate[];
  powerUpSpawns: PowerUpSpawn[];
  npcs?: MazeNPC[];
  shortestPathLength?: number;
}

export interface RoomSettings {
  maxPlayers: number;
  questionTimeLimit: number;
  difficulty: MazeDifficulty;
  powerUpsEnabled: boolean;
  gameMode: GameMode;
  gameDurationMinutes?: number;
  showExplanations: boolean;
}

export type RoomStatus = 'LOBBY' | 'STARTING' | 'PLAYING' | 'PAUSED' | 'ENDED';

export interface GameRoomState {
  id: string;
  code: string;
  name: string;
  hostName: string;
  hostSocketId: string;
  status: RoomStatus;
  settings: RoomSettings;
  quizSetId: string;
  quizTitle: string;
  players: Record<string, Player>;
  maze?: MazeData;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  pausedAt?: number;
  pauseRemainingMs?: number;
  timeRemaining?: number;
}

export interface ClientMovePayload {
  roomId: string;
  playerId: string;
  targetX: number;
  targetY: number;
  clientTime: number;
}

export interface PositionUpdatePayload {
  playerId: string;
  x: number;
  y: number;
  progress: number;
  activeEffects: PlayerEffects;
}

export interface QuestionIssuedPayload {
  obstacleId: string;
  question: Omit<Question, 'correctAnswer'>;
  timeLimit: number;
  expiresAt: number;
  streak?: number;
  requiredStreak?: number;
}

export interface SubmitAnswerPayload {
  roomId: string;
  playerId: string;
  obstacleId: string;
  questionId: string;
  selectedOptionId: string;
  responseTimeMs: number;
}

export interface AnswerResultPayload {
  playerId: string;
  obstacleId: string;
  isCorrect: boolean;
  correctAnswer?: string;
  explanation?: string;
  rewardPowerUp?: PowerUpType;
  penaltySeconds?: number;
  newProgress?: number;
  streak?: number;
  requiredStreak?: number;
  gateUnlocked?: boolean;
  nextQuestion?: Omit<Question, 'correctAnswer'>;
}

export interface PlayerStunnedPayload {
  playerId: string;
  npcName: string;
  durationSeconds: number;
  x: number;
  y: number;
  message: string;
}

export interface UsePowerUpPayload {
  roomId: string;
  playerId: string;
  powerUpType: PowerUpType;
  targetPlayerId?: string;
}

export interface PowerUpAppliedPayload {
  sourcePlayerId: string;
  sourceNickname: string;
  powerUpType: PowerUpType;
  targetPlayerId?: string;
  targetNickname?: string;
  absorbedByShield?: boolean;
  message: string;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  avatar: string;
  rank: number;
  isFinished: boolean;
  finishedAt?: number;
  progress: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  itemsUsedCount: number;
  distanceToFinish?: number;
  badge?: string;
}

export interface GameOverPayload {
  roomId: string;
  leaderboard: LeaderboardEntry[];
  totalDurationMs: number;
  endedReason: 'completed' | 'timeout' | 'host_terminated';
}
