import {
  AnswerResultPayload,
  CellType,
  ClientMovePayload,
  GameOverPayload,
  GameRoomState,
  LeaderboardEntry,
  MazeNPC,
  ObstacleGate,
  Player,
  PlayerEffects,
  POWER_UPS,
  PowerUpAppliedPayload,
  PowerUpSpawn,
  PowerUpType,
  Question,
  QuestionIssuedPayload,
  QuizSet,
  RoomSettings,
  RoomStatus,
  SubmitAnswerPayload,
  UsePowerUpPayload,
} from '../types/game.js';
import { MazeGenerator } from './MazeGenerator.js';
import { PRESET_QUIZ_SETS } from './PresetQuestions.js';

export class GameEngine {
  private rooms: Map<string, GameRoomState> = new Map();
  private questionsByRoom: Map<string, Map<string, Question>> = new Map();
  private playerMoveCooldowns: Map<string, number> = new Map(); // playerId -> timestamp
  private customQuizSets: Map<string, QuizSet> = new Map();
  private playerGateStreaks: Map<string, number> = new Map(); // `${roomId}_${playerId}_${gateId}` -> streak

  constructor() {
    // Seed preset quiz sets
    for (const qs of PRESET_QUIZ_SETS) {
      this.customQuizSets.set(qs.id, qs);
    }
  }

  // --- Quiz Management ---
  public getQuizSets(): QuizSet[] {
    return Array.from(this.customQuizSets.values());
  }

  public getQuizSetById(id: string): QuizSet | undefined {
    return this.customQuizSets.get(id);
  }

  public saveQuizSet(quizSet: QuizSet): QuizSet {
    this.customQuizSets.set(quizSet.id, quizSet);
    return quizSet;
  }

  public deleteQuizSet(id: string): boolean {
    if (PRESET_QUIZ_SETS.some((p) => p.id === id)) {
      // Don't delete presets, just return false
      return false;
    }
    return this.customQuizSets.delete(id);
  }

  // --- Room Management ---
  public generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude 0, O, 1, I for clarity
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (Array.from(this.rooms.values()).some((r) => r.code === code));
    return code;
  }

  public createRoom(
    hostName: string,
    hostSocketId: string,
    roomName: string,
    quizSetId: string,
    settings?: Partial<RoomSettings>
  ): GameRoomState {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const roomCode = this.generateRoomCode();

    const selectedQuizSet =
      this.getQuizSetById(quizSetId) || PRESET_QUIZ_SETS[0];

    const defaultSettings: RoomSettings = {
      maxPlayers: settings?.maxPlayers || 20,
      questionTimeLimit: settings?.questionTimeLimit || 20,
      difficulty: settings?.difficulty || 'medium',
      powerUpsEnabled: settings?.powerUpsEnabled ?? true,
      gameMode: settings?.gameMode || 'classic',
      gameDurationMinutes: settings?.gameDurationMinutes || 5,
      showExplanations: settings?.showExplanations ?? true,
    };

    const hostPlayer: Player = {
      id: `player_host_${Date.now()}`,
      socketId: hostSocketId,
      nickname: hostName,
      avatar: 'fox',
      isHost: true,
      x: 1,
      y: 1,
      progress: 0,
      inventory: [],
      activeEffects: {},
      isFinished: false,
      score: 0,
      correctCount: 0,
      wrongCount: 0,
      itemsUsedCount: 0,
      attacksAbsorbedCount: 0,
      connected: true,
    };

    const room: GameRoomState = {
      id: roomId,
      code: roomCode,
      name: roomName || `Phòng của ${hostName}`,
      hostName,
      hostSocketId,
      status: 'LOBBY',
      settings: defaultSettings,
      quizSetId: selectedQuizSet.id,
      quizTitle: selectedQuizSet.title,
      players: {
        [hostPlayer.id]: hostPlayer,
      },
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);

    // Index questions for this room
    const questionMap = new Map<string, Question>();
    for (const q of selectedQuizSet.questions) {
      questionMap.set(q.id, q);
    }
    this.questionsByRoom.set(roomId, questionMap);

    return room;
  }

  public getRoomById(roomId: string): GameRoomState | undefined {
    return this.rooms.get(roomId);
  }

  public getRoomByCode(code: string): GameRoomState | undefined {
    const upper = code.trim().toUpperCase();
    return Array.from(this.rooms.values()).find((r) => r.code === upper);
  }

  public joinRoom(
    code: string,
    nickname: string,
    avatar: string,
    socketId: string
  ): { room?: GameRoomState; player?: Player; error?: string } {
    const room = this.getRoomByCode(code);
    if (!room) {
      return { error: 'Không tìm thấy phòng với mã này. Vui lòng kiểm tra lại.' };
    }

    if (room.status === 'ENDED') {
      return { error: 'Trận đấu trong phòng này đã kết thúc.' };
    }

    const currentPlayers = Object.values(room.players);

    // Check if player is reconnecting with same nickname
    const existingPlayer = currentPlayers.find(
      (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
    );

    if (existingPlayer) {
      if (!existingPlayer.connected) {
        // Reconnect player
        existingPlayer.socketId = socketId;
        existingPlayer.connected = true;
        return { room, player: existingPlayer };
      } else {
        return { error: 'Nickname này đang được sử dụng trong phòng.' };
      }
    }

    if (room.status !== 'LOBBY' && room.status !== 'STARTING') {
      return { error: 'Trận đấu đã bắt đầu, không thể tham gia mới.' };
    }

    if (currentPlayers.length >= room.settings.maxPlayers) {
      return { error: 'Phòng đã đủ số lượng người chơi tối đa.' };
    }

    const playerId = `player_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newPlayer: Player = {
      id: playerId,
      socketId,
      nickname,
      avatar: avatar || 'rabbit',
      isHost: false,
      x: 1,
      y: 1,
      progress: 0,
      inventory: [],
      activeEffects: {},
      isFinished: false,
      score: 0,
      correctCount: 0,
      wrongCount: 0,
      itemsUsedCount: 0,
      attacksAbsorbedCount: 0,
      connected: true,
    };

    room.players[playerId] = newPlayer;
    if (room.maze) {
      this.ensurePlayerGates(room, playerId);
    }
    return { room, player: newPlayer };
  }

  public ensurePlayerGates(room: GameRoomState, playerId: string) {
    if (!room.maze || !room.maze.obstacleGates) return;
    const hasPlayerGates = room.maze.obstacleGates.some((g) => g.playerId === playerId);
    if (!hasPlayerGates) {
      const qMap = this.questionsByRoom.get(room.id);
      const qIds = qMap ? Array.from(qMap.keys()) : [];
      const newGates = MazeGenerator.generatePlayerGates(room.maze, playerId, qIds);
      room.maze.obstacleGates.push(...newGates);
    }
  }

  public handleDisconnect(socketId: string): {
    room?: GameRoomState;
    player?: Player;
    isHost: boolean;
  } {
    for (const room of this.rooms.values()) {
      const player = Object.values(room.players).find(
        (p) => p.socketId === socketId
      );
      if (player) {
        player.connected = false;
        const isHost = player.isHost;
        return { room, player, isHost };
      }
    }
    return { isHost: false };
  }

  public kickPlayer(
    roomId: string,
    hostSocketId: string,
    targetPlayerId: string
  ): { success: boolean; targetSocketId?: string; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Phòng không tồn tại' };
    if (room.hostSocketId !== hostSocketId) {
      return { success: false, error: 'Chỉ host mới có quyền kick người chơi' };
    }
    const target = room.players[targetPlayerId];
    if (!target) return { success: false, error: 'Người chơi không tồn tại' };
    if (target.isHost) return { success: false, error: 'Không thể kick host' };

    const targetSocketId = target.socketId;
    delete room.players[targetPlayerId];
    return { success: true, targetSocketId };
  }

  // --- Start Game ---
  public startGame(
    roomId: string,
    hostSocketId: string
  ): { success: boolean; room?: GameRoomState; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Phòng không tồn tại' };
    if (room.hostSocketId !== hostSocketId) {
      return { success: false, error: 'Chỉ host mới có quyền bắt đầu trận đấu' };
    }

    const playerCount = Object.values(room.players).length;
    if (playerCount < 2 && room.settings.gameMode !== 'practice') {
      return {
        success: false,
        error: 'Cần tối thiểu 2 người chơi để bắt đầu (hoặc chuyển sang chế độ Luyện Tập Đơn).',
      };
    }

    // Get question IDs from room question set and shuffle randomly
    const questionMap = this.questionsByRoom.get(roomId);
    const questionIds = questionMap ? Array.from(questionMap.keys()) : [];
    const shuffledQuestionIds = [...questionIds].sort(() => Math.random() - 0.5);

    // Generate maze with authoritative logic and randomized question distribution
    const playerIds = Object.keys(room.players);
    const maze = MazeGenerator.generate(
      room.settings.difficulty,
      shuffledQuestionIds,
      playerIds
    );
    room.maze = maze;
    room.status = 'PLAYING';
    room.startedAt = Date.now();
    room.timeRemaining = (room.settings.gameDurationMinutes || 5) * 60;

    // Reset all players to start position
    for (const player of Object.values(room.players)) {
      player.x = maze.startPos.x;
      player.y = maze.startPos.y;
      player.progress = 0;
      player.inventory = [];
      player.activeEffects = {};
      player.isFinished = false;
      delete player.finishedAt;
      delete player.rank;
      delete player.currentObstacleId;
    }

    return { success: true, room };
  }

  // --- Player Movement & Obstacle Triggers ---
  public handlePlayerMove(payload: ClientMovePayload): {
    valid: boolean;
    player?: Player;
    obstacleTriggered?: {
      obstacleId: string;
      questionIssued: QuestionIssuedPayload;
    };
    powerUpCollected?: PowerUpType;
    finished?: boolean;
    npcCollision?: {
      npcName: string;
      durationSeconds: number;
    };
    reason?: string;
  } {
    const { roomId, playerId, targetX, targetY } = payload;
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'PLAYING' || !room.maze) {
      return { valid: false, reason: 'Trận đấu chưa bắt đầu hoặc đang tạm dừng' };
    }

    const player = room.players[playerId];
    if (!player || !player.connected || player.isFinished) {
      return { valid: false, reason: 'Người chơi không hợp lệ hoặc đã về đích' };
    }

    const now = Date.now();

    // 1. Check freeze / stun effect
    if (player.activeEffects.freezeUntil && player.activeEffects.freezeUntil > now) {
      const remainSec = Math.ceil((player.activeEffects.freezeUntil - now) / 1000);
      const reason = player.activeEffects.stunnedByNpc
        ? `Bị choáng bởi Vệ Binh Mê Cung! Còn ${remainSec}s`
        : `Bạn đang bị đóng băng! Còn ${remainSec}s`;
      return { valid: false, reason };
    } else {
      player.activeEffects.stunnedByNpc = false;
    }

    // 2. Anti-speed-hack: enforce minimum move cooldown
    const lastMove = this.playerMoveCooldowns.get(playerId) || 0;
    let minMoveInterval = 130; // base ms per step
    if (player.activeEffects.slowUntil && player.activeEffects.slowUntil > now) {
      minMoveInterval = 240; // slowed
    } else if (
      player.activeEffects.speedUntil &&
      player.activeEffects.speedUntil > now
    ) {
      minMoveInterval = 80; // boosted
    }

    if (now - lastMove < minMoveInterval) {
      return { valid: false, reason: 'Di chuyển quá nhanh' };
    }

    // 3. Check bounds
    if (
      targetX < 0 ||
      targetX >= room.maze.width ||
      targetY < 0 ||
      targetY >= room.maze.height
    ) {
      return { valid: false, reason: 'Vị trí ngoài mê cung' };
    }

    // 4. Check step adjacency: must be exactly 1 orthogonal step
    const dx = Math.abs(targetX - player.x);
    const dy = Math.abs(targetY - player.y);
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) {
      return { valid: false, reason: 'Chỉ được di chuyển từng ô liền kề' };
    }

    // 5. Check wall collision
    const targetCell = room.maze.grid[targetY][targetX];
    if (targetCell === CellType.WALL) {
      return { valid: false, reason: 'Không thể đi xuyên tường' };
    }

    // 6. Check Obstacle Gate (Requires 3 consecutive correct answers)
    // Only gates assigned to this player (or shared gates) will block and trigger questions
    const gate = room.maze.obstacleGates.find(
      (g) => g.x === targetX && g.y === targetY && (!g.playerId || g.playerId === playerId)
    );

    if (gate && !gate.unlockedBy.includes(playerId)) {
        player.currentObstacleId = gate.id;

        const streakKey = `${roomId}_${playerId}_${gate.id}`;
        const currentStreak = this.playerGateStreaks.get(streakKey) || 0;

        const qMap = this.questionsByRoom.get(roomId);
        if (qMap) {
          const qList = Array.from(qMap.values());
          const baseIdx = qList.findIndex((q) => q.id === gate.questionId);
          const qIndex = (baseIdx >= 0 ? baseIdx + currentStreak : currentStreak) % qList.length;
          const question = qList[qIndex];

          if (question) {
            const timeLimit = player.activeEffects.timeAttackActive
              ? Math.max(5, Math.floor(question.timeLimit / 2))
              : question.timeLimit;

            const questionClean: Omit<Question, 'correctAnswer'> = {
              id: question.id,
              type: question.type,
              content: question.content,
              options: question.options,
              difficulty: question.difficulty,
              timeLimit,
              rewardType: question.rewardType,
            };

            const questionIssued: QuestionIssuedPayload = {
              obstacleId: gate.id,
              question: questionClean,
              timeLimit,
              expiresAt: now + timeLimit * 1000,
              streak: currentStreak,
              requiredStreak: 3,
            };

            return {
              valid: false,
              player,
              obstacleTriggered: {
                obstacleId: gate.id,
                questionIssued,
              },
              reason: `Gặp ô khóa! Cần trả lời đúng 3 câu liên tiếp (Hiện tại: ${currentStreak}/3)!`,
            };
          }
        }
      }

    // 7. Move is valid! Update position and cooldown
    player.x = targetX;
    player.y = targetY;
    this.playerMoveCooldowns.set(playerId, now);

    // 7b. Check NPC Collision when stepping onto tile
    let npcCollision: { npcName: string; durationSeconds: number } | undefined;
    const hitNpc = room.maze.npcs?.find((n) => n.x === targetX && n.y === targetY);
    if (hitNpc) {
      player.activeEffects.freezeUntil = now + 5000;
      player.activeEffects.stunnedByNpc = true;
      npcCollision = {
        npcName: hitNpc.name,
        durationSeconds: 5,
      };
    }

    // 8. Update progress
    const shortestPath = MazeGenerator.findShortestPath(
      room.maze.grid,
      room.maze.startPos,
      room.maze.finishPos
    );
    player.progress = MazeGenerator.calculateProgress(
      { x: player.x, y: player.y },
      room.maze.startPos,
      room.maze.finishPos,
      shortestPath
    );

    // 9. Check PowerUp Box pickup
    let collectedPowerUp: PowerUpType | undefined;
    if (room.settings.powerUpsEnabled && targetCell === CellType.POWERUP_BOX) {
      const spawn = room.maze.powerUpSpawns.find(
        (p) => p.x === targetX && p.y === targetY
      );
      if (spawn && !spawn.collectedBy.includes(playerId)) {
        spawn.collectedBy.push(playerId);
        // Add to inventory if < 3
        if (player.inventory.length < 3) {
          player.inventory.push(spawn.type);
          collectedPowerUp = spawn.type;
        }
      }
    }

    // 10. Check Finish Gate
    let playerFinished = false;
    if (
      targetX === room.maze.finishPos.x &&
      targetY === room.maze.finishPos.y
    ) {
      playerFinished = true;
      player.isFinished = true;
      player.finishedAt = now;
      player.progress = 100;

      // Calculate rank
      const finishedPlayers = Object.values(room.players).filter(
        (p) => p.isFinished && p.id !== playerId
      );
      player.rank = finishedPlayers.length + 1;
      player.score += Math.max(100, 1000 - player.rank * 100);
    }

    return {
      valid: true,
      player,
      powerUpCollected: collectedPowerUp,
      finished: playerFinished,
      npcCollision,
    };
  }

  // --- Submit Answer & Unlock Gate ---
  public submitAnswer(payload: SubmitAnswerPayload): {
    success: boolean;
    result?: AnswerResultPayload;
    player?: Player;
    error?: string;
  } {
    const { roomId, playerId, obstacleId, questionId, selectedOptionId, responseTimeMs } =
      payload;
    const room = this.rooms.get(roomId);
    if (!room || !room.maze) return { success: false, error: 'Phòng không tồn tại' };

    const player = room.players[playerId];
    if (!player) return { success: false, error: 'Người chơi không tồn tại' };

    const qMap = this.questionsByRoom.get(roomId);
    if (!qMap) return { success: false, error: 'Bộ câu hỏi không tồn tại' };

    const question = qMap.get(questionId);
    if (!question) return { success: false, error: 'Câu hỏi không tồn tại' };

    // Reset time attack flag on answer submission
    player.activeEffects.timeAttackActive = false;

    const streakKey = `${roomId}_${playerId}_${obstacleId}`;
    let currentStreak = this.playerGateStreaks.get(streakKey) || 0;

    const isCorrect = question.correctAnswer === selectedOptionId;
    let rewardPowerUp: PowerUpType | undefined;

    if (isCorrect) {
      currentStreak += 1;
      player.correctCount++;
      player.score += 150;

      if (currentStreak >= 3) {
        // Successfully achieved 3 consecutive correct answers! UNLOCK GATE!
        this.playerGateStreaks.delete(streakKey);
        const gate = room.maze.obstacleGates.find((g) => g.id === obstacleId);
        if (gate && !gate.unlockedBy.includes(playerId)) {
          gate.unlockedBy.push(playerId);
        }

        delete player.currentObstacleId;

        // Random power-up reward if enabled and space available
        if (room.settings.powerUpsEnabled && player.inventory.length < 3) {
          const pool: PowerUpType[] = [
            'speed_boost',
            'shield',
            'reveal_path',
            'lucky_key',
            'teleport',
            'ice_trap',
          ];
          rewardPowerUp = pool[Math.floor(Math.random() * pool.length)];
          player.inventory.push(rewardPowerUp);
        }

        const result: AnswerResultPayload = {
          playerId,
          obstacleId,
          isCorrect: true,
          correctAnswer: question.correctAnswer,
          rewardPowerUp,
          newProgress: player.progress,
          streak: 3,
          requiredStreak: 3,
          gateUnlocked: true,
        };

        return { success: true, result, player };
      } else {
        // Intermediate streak (1/3 or 2/3) - prepare next question!
        this.playerGateStreaks.set(streakKey, currentStreak);

        // Randomize the next question in the streak (avoiding duplicate of current question)
        const qList = Array.from(qMap.values());
        const candidates = qList.filter((q) => q.id !== questionId);
        const nextQ = candidates[Math.floor(Math.random() * candidates.length)] || qList[0];

        const nextQuestionClean: Omit<Question, 'correctAnswer'> = {
          id: nextQ.id,
          type: nextQ.type,
          content: nextQ.content,
          options: nextQ.options,
          difficulty: nextQ.difficulty,
          timeLimit: nextQ.timeLimit,
          rewardType: nextQ.rewardType,
        };

        const result: AnswerResultPayload = {
          playerId,
          obstacleId,
          isCorrect: true,
          correctAnswer: question.correctAnswer,
          newProgress: player.progress,
          streak: currentStreak,
          requiredStreak: 3,
          gateUnlocked: false,
          nextQuestion: nextQuestionClean,
        };

        return { success: true, result, player };
      }
    } else {
      // Wrong answer -> streak resets to 0, freeze 3s!
      this.playerGateStreaks.set(streakKey, 0);
      player.wrongCount++;
      player.score = Math.max(0, player.score - 30);

      // Penalty: freeze for 3 seconds before can retry
      player.activeEffects.freezeUntil = Date.now() + 3000;

      const result: AnswerResultPayload = {
        playerId,
        obstacleId,
        isCorrect: false,
        correctAnswer: '', // Never reveal correct answer on wrong submission
        explanation: undefined, // Never reveal explanation on wrong submission
        penaltySeconds: 3,
        streak: 0,
        requiredStreak: 3,
        gateUnlocked: false,
        newProgress: player.progress,
      };

      return { success: true, result, player };
    }
  }

  // --- Use Power-Up Authoritative Logic ---
  public usePowerUp(payload: UsePowerUpPayload): {
    success: boolean;
    applied?: PowerUpAppliedPayload;
    sourcePlayer?: Player;
    targetPlayer?: Player;
    teleportPos?: { x: number; y: number };
    error?: string;
  } {
    const { roomId, playerId, powerUpType, targetPlayerId } = payload;
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'PLAYING' || !room.maze) {
      return { success: false, error: 'Trận đấu chưa bắt đầu' };
    }

    const source = room.players[playerId];
    if (!source) return { success: false, error: 'Người chơi không tồn tại' };

    const invIndex = source.inventory.indexOf(powerUpType);
    if (invIndex === -1) {
      return { success: false, error: 'Bạn không sở hữu vật phẩm này' };
    }

    // Consume item
    source.inventory.splice(invIndex, 1);
    source.itemsUsedCount++;

    const now = Date.now();
    let target: Player | undefined;
    if (targetPlayerId) {
      target = room.players[targetPlayerId];
    }

    let absorbedByShield = false;
    let message = '';
    let teleportPos: { x: number; y: number } | undefined;

    switch (powerUpType) {
      case 'ice_trap': {
        if (!target || target.isFinished) {
          return { success: false, error: 'Mục tiêu không hợp lệ' };
        }
        if (target.activeEffects.shieldActive) {
          target.activeEffects.shieldActive = false;
          target.attacksAbsorbedCount++;
          absorbedByShield = true;
          message = `Khiên của ${target.nickname} đã chặn thành công Bẫy Băng từ ${source.nickname}!`;
        } else {
          target.activeEffects.slowUntil = now + 5000;
          message = `${source.nickname} đã giăng Bẫy Băng làm chậm ${target.nickname} trong 5 giây!`;
        }
        break;
      }

      case 'time_freeze': {
        if (!target || target.isFinished) {
          return { success: false, error: 'Mục tiêu không hợp lệ' };
        }
        if (target.activeEffects.shieldActive) {
          target.activeEffects.shieldActive = false;
          target.attacksAbsorbedCount++;
          absorbedByShield = true;
          message = `Khiên của ${target.nickname} đã chặn hiệu ứng Đóng Băng từ ${source.nickname}!`;
        } else {
          target.activeEffects.freezeUntil = now + 3000;
          message = `${source.nickname} đã Đóng Băng ${target.nickname} trong 3 giây!`;
        }
        break;
      }

      case 'time_attack': {
        if (!target || target.isFinished) {
          return { success: false, error: 'Mục tiêu không hợp lệ' };
        }
        if (target.activeEffects.shieldActive) {
          target.activeEffects.shieldActive = false;
          target.attacksAbsorbedCount++;
          absorbedByShield = true;
          message = `Khiên của ${target.nickname} đã chặn Ép Thời Gian từ ${source.nickname}!`;
        } else {
          target.activeEffects.timeAttackActive = true;
          message = `${source.nickname} đã kích hoạt Ép Thời Gian lên câu hỏi tiếp theo của ${target.nickname}!`;
        }
        break;
      }

      case 'speed_boost': {
        source.activeEffects.speedUntil = now + 5000;
        message = `${source.nickname} đã kích hoạt Tăng Tốc siêu tốc trong 5 giây!`;
        break;
      }

      case 'shield': {
        source.activeEffects.shieldActive = true;
        message = `${source.nickname} đã kích hoạt Khiên Bảo Vệ chống lại đòn tấn công tiếp theo!`;
        break;
      }

      case 'reveal_path': {
        message = `${source.nickname} đã sử dụng La Bàn Hé Lộ Đường Đi!`;
        break;
      }

      case 'lucky_key': {
        // Automatically unlock nearest locked obstacle gate ahead of player
        const lockedGates = room.maze.obstacleGates.filter(
          (g) => !g.unlockedBy.includes(playerId)
        );
        if (lockedGates.length > 0) {
          // Sort by distance to player
          lockedGates.sort((a, b) => {
            const distA = Math.abs(a.x - source.x) + Math.abs(a.y - source.y);
            const distB = Math.abs(b.x - source.x) + Math.abs(b.y - source.y);
            return distA - distB;
          });
          const nearestGate = lockedGates[0];
          nearestGate.unlockedBy.push(playerId);
          if (source.currentObstacleId === nearestGate.id) {
            delete source.currentObstacleId;
          }
          message = `${source.nickname} đã dùng Chìa Khóa Vàng mở toang chướng ngại vật!`;
        } else {
          message = `${source.nickname} đã kích hoạt Chìa Khóa Vàng!`;
        }
        break;
      }

      case 'teleport': {
        // Warp player forward along path 4-5 steps if no wall or locked gate
        const path = MazeGenerator.findShortestPath(
          room.maze.grid,
          { x: source.x, y: source.y },
          room.maze.finishPos
        );
        if (path && path.length > 2) {
          let jumpSteps = Math.min(4, path.length - 2);
          // Check for locked obstacle in between
          for (let i = 1; i <= jumpSteps; i++) {
            const pt = path[i];
            const gate = room.maze.obstacleGates.find(
              (g) => g.x === pt.x && g.y === pt.y
            );
            if (gate && !gate.unlockedBy.includes(playerId)) {
              jumpSteps = i - 1;
              break;
            }
          }
          if (jumpSteps > 0) {
            const dest = path[jumpSteps];
            source.x = dest.x;
            source.y = dest.y;
            teleportPos = dest;
            source.progress = MazeGenerator.calculateProgress(
              dest,
              room.maze.startPos,
              room.maze.finishPos,
              path
            );
            message = `${source.nickname} đã dịch chuyển tiến lên ${jumpSteps} bước!`;
          } else {
            message = `${source.nickname} đã thử dịch chuyển nhưng bị chặn bởi chướng ngại vật!`;
          }
        }
        break;
      }
    }

    const applied: PowerUpAppliedPayload = {
      sourcePlayerId: playerId,
      sourceNickname: source.nickname,
      powerUpType,
      targetPlayerId,
      targetNickname: target?.nickname,
      absorbedByShield,
      message,
    };

    return {
      success: true,
      applied,
      sourcePlayer: source,
      targetPlayer: target,
      teleportPos,
    };
  }

  // --- Leaderboard & Game Over ---
  public getLeaderboard(roomId: string): LeaderboardEntry[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const players = Object.values(room.players);
    const maze = room.maze;

    // Calculate distanceToFinish for all players (shortest BFS path or Manhattan distance)
    const playerDistances: Record<string, number> = {};
    for (const p of players) {
      if (p.isFinished) {
        playerDistances[p.id] = 0;
      } else if (maze) {
        const path = MazeGenerator.findShortestPath(maze.grid, { x: p.x, y: p.y }, maze.finishPos);
        if (path && path.length > 0) {
          playerDistances[p.id] = path.length - 1;
        } else {
          playerDistances[p.id] = Math.abs(maze.finishPos.x - p.x) + Math.abs(maze.finishPos.y - p.y);
        }
      } else {
        playerDistances[p.id] = 999;
      }
    }

    // Sort rule:
    // 1. Finished players first, sorted by finishedAt ascending (earlier finish = better rank)
    // 2. Unfinished players sorted by distanceToFinish ascending (closer to finish = better rank!)
    // 3. If tie: progress descending, then score descending, then correctCount descending
    players.sort((a, b) => {
      if (a.isFinished && b.isFinished) {
        return (a.finishedAt || 0) - (b.finishedAt || 0);
      }
      if (a.isFinished) return -1;
      if (b.isFinished) return 1;

      const distA = playerDistances[a.id] ?? 9999;
      const distB = playerDistances[b.id] ?? 9999;
      if (distA !== distB) {
        return distA - distB;
      }

      if (b.progress !== a.progress) return b.progress - a.progress;
      if (b.score !== a.score) return b.score - a.score;
      return b.correctCount - a.correctCount;
    });

    return players.map((p, index) => {
      const rank = index + 1;
      let badge: string | undefined;
      if (rank === 1 && p.isFinished) badge = 'Maze Champion 🏆';
      else if (rank === 1 && !p.isFinished) badge = 'Tiên Phong Gần Đích Nhất 🌟';
      else if (rank === 2 && p.isFinished) badge = 'Master Explorer 🥈';
      else if (rank === 3 && p.isFinished) badge = 'Knowledge Runner 🥉';
      else if (p.correctCount >= 5) badge = 'Scholar 🎓';
      else if (p.itemsUsedCount >= 3) badge = 'Tactician ⚔️';

      return {
        playerId: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        rank,
        isFinished: p.isFinished,
        finishedAt: p.finishedAt,
        progress: p.progress,
        score: p.score,
        correctCount: p.correctCount,
        wrongCount: p.wrongCount,
        itemsUsedCount: p.itemsUsedCount,
        distanceToFinish: playerDistances[p.id],
        badge,
      };
    });
  }

  public handleGameTimeout(roomId: string): {
    success: boolean;
    gameOverPayload?: GameOverPayload;
  } {
    const room = this.rooms.get(roomId);
    if (!room || room.status === 'ENDED') return { success: false };

    room.status = 'ENDED';
    room.endedAt = Date.now();
    room.timeRemaining = 0;
    const leaderboard = this.getLeaderboard(roomId);
    const totalDurationMs = room.startedAt
      ? room.endedAt - room.startedAt
      : 0;

    return {
      success: true,
      gameOverPayload: {
        roomId,
        leaderboard,
        totalDurationMs,
        endedReason: 'timeout',
      },
    };
  }

  public checkGameCompletion(roomId: string): {
    completed: boolean;
    gameOverPayload?: GameOverPayload;
  } {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'PLAYING') return { completed: false };

    const players = Object.values(room.players);
    const connectedPlayers = players.filter((p) => p.connected);

    // If all connected players have finished
    const allFinished =
      connectedPlayers.length > 0 &&
      connectedPlayers.every((p) => p.isFinished);

    if (allFinished) {
      room.status = 'ENDED';
      room.endedAt = Date.now();
      const leaderboard = this.getLeaderboard(roomId);
      const totalDurationMs = room.startedAt
        ? room.endedAt - room.startedAt
        : 0;

      return {
        completed: true,
        gameOverPayload: {
          roomId,
          leaderboard,
          totalDurationMs,
          endedReason: 'completed',
        },
      };
    }

    return { completed: false };
  }

  public pauseGame(
    roomId: string,
    hostSocketId: string
  ): { success: boolean; room?: GameRoomState; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Phòng không tồn tại' };
    if (room.hostSocketId !== hostSocketId) {
      return { success: false, error: 'Chỉ host mới có quyền tạm dừng' };
    }
    if (room.status !== 'PLAYING') {
      return { success: false, error: 'Trận đấu không trong trạng thái đang chơi' };
    }

    room.status = 'PAUSED';
    room.pausedAt = Date.now();
    return { success: true, room };
  }

  public resumeGame(
    roomId: string,
    hostSocketId: string
  ): { success: boolean; room?: GameRoomState; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Phòng không tồn tại' };
    if (room.hostSocketId !== hostSocketId) {
      return { success: false, error: 'Chỉ host mới có quyền tiếp tục' };
    }
    if (room.status !== 'PAUSED') {
      return { success: false, error: 'Trận đấu không bị tạm dừng' };
    }

    room.status = 'PLAYING';
    delete room.pausedAt;
    return { success: true, room };
  }

  public endGame(
    roomId: string,
    hostSocketId: string
  ): { success: boolean; gameOverPayload?: GameOverPayload; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Phòng không tồn tại' };
    if (room.hostSocketId !== hostSocketId) {
      return { success: false, error: 'Chỉ host mới có quyền kết thúc trận đấu' };
    }

    room.status = 'ENDED';
    room.endedAt = Date.now();
    const leaderboard = this.getLeaderboard(roomId);
    const totalDurationMs = room.startedAt
      ? room.endedAt - room.startedAt
      : 0;

    return {
      success: true,
      gameOverPayload: {
        roomId,
        leaderboard,
        totalDurationMs,
        endedReason: 'host_terminated',
      },
    };
  }

  // --- NPC Tick & Collision AI ---
  public tickNPCs(roomId: string): {
    npcs: MazeNPC[];
    collisions: { playerId: string; npcName: string }[];
  } {
    const room = this.rooms.get(roomId);
    if (!room || !room.maze || !room.maze.npcs || room.status !== 'PLAYING') {
      return { npcs: [], collisions: [] };
    }

    const { grid, width, height } = room.maze;
    const collisions: { playerId: string; npcName: string }[] = [];
    const now = Date.now();

    room.maze.npcs.forEach((npc) => {
      const dirs = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
      ];

      const validMoves = dirs.filter((d) => {
        const nx = npc.x + d.dx;
        const ny = npc.y + d.dy;
        return (
          nx > 0 &&
          nx < width - 1 &&
          ny > 0 &&
          ny < height - 1 &&
          grid[ny][nx] !== CellType.WALL
        );
      });

      if (validMoves.length > 0) {
        // Prefer straight continuation with 65% probability
        const keepDir = validMoves.find((d) => d.dx === npc.dx && d.dy === npc.dy);
        let chosen = keepDir && Math.random() < 0.65 ? keepDir : null;

        if (!chosen) {
          // Avoid 180 degree immediate reversal if alternatives exist
          const nonReverseMoves = validMoves.filter(
            (d) => !(d.dx === -npc.dx && d.dy === -npc.dy)
          );
          const pool = nonReverseMoves.length > 0 ? nonReverseMoves : validMoves;
          chosen = pool[Math.floor(Math.random() * pool.length)];
        }

        npc.x += chosen.dx;
        npc.y += chosen.dy;
        npc.dx = chosen.dx;
        npc.dy = chosen.dy;
      }

      // Check collision with any active player
      Object.values(room.players).forEach((p) => {
        if (!p.isFinished && p.x === npc.x && p.y === npc.y) {
          if (!p.activeEffects.freezeUntil || p.activeEffects.freezeUntil < now) {
            p.activeEffects.freezeUntil = now + 5000;
            p.activeEffects.stunnedByNpc = true;
            collisions.push({ playerId: p.id, npcName: npc.name });
          }
        }
      });
    });

    return { npcs: room.maze.npcs, collisions };
  }
}
