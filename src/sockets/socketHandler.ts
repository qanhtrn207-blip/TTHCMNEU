import { Server, Socket } from 'socket.io';
import { GameEngine } from '../game/GameEngine.js';
import {
  ClientMovePayload,
  PositionUpdatePayload,
  SubmitAnswerPayload,
  UsePowerUpPayload,
} from '../types/game.js';
import { extractClientIp, isAuthorizedHost } from '../utils/ipCheck.js';

export function registerSocketHandlers(io: Server, engine: GameEngine) {
  io.on('connection', (socket: Socket) => {
    // 1. Create Room (Host IP restriction: Only 192.168.50.117 & localhost)
    socket.on(
      'create-room',
      (
        data: {
          hostName: string;
          roomName: string;
          quizSetId: string;
          settings?: any;
          hostPasscode?: string;
        },
        callback?: (res: any) => void
      ) => {
        try {
          const clientIp = extractClientIp(socket);
          const auth = isAuthorizedHost(clientIp, data.hostPasscode);

          if (!auth.allowed) {
            const errorMsg = auth.reason || 'Chỉ thiết bị IP 192.168.50.117 mới được phép tạo phòng!';
            if (callback) callback({ success: false, error: errorMsg });
            socket.emit('error-message', { message: errorMsg });
            return;
          }
          const room = engine.createRoom(
            data.hostName || 'Giáo viên',
            socket.id,
            data.roomName,
            data.quizSetId,
            data.settings
          );

          socket.join(room.id);
          const hostPlayer = Object.values(room.players).find((p) => p.isHost);

          if (callback) {
            callback({
              success: true,
              room,
              player: hostPlayer,
            });
          }

          io.to(room.id).emit('room-updated', room);
        } catch (err: any) {
          if (callback) callback({ success: false, error: err.message });
          socket.emit('error-message', { message: err.message });
        }
      }
    );

    // 2. Join Room
    socket.on(
      'join-room',
      (
        data: {
          code: string;
          nickname: string;
          avatar: string;
        },
        callback?: (res: any) => void
      ) => {
        try {
          const result = engine.joinRoom(
            data.code,
            data.nickname,
            data.avatar,
            socket.id
          );

          if (result.error || !result.room || !result.player) {
            if (callback) callback({ success: false, error: result.error });
            socket.emit('error-message', { message: result.error });
            return;
          }

          socket.join(result.room.id);

          if (callback) {
            callback({
              success: true,
              room: result.room,
              player: result.player,
            });
          }

          io.to(result.room.id).emit('room-updated', result.room);
        } catch (err: any) {
          if (callback) callback({ success: false, error: err.message });
          socket.emit('error-message', { message: err.message });
        }
      }
    );

    // 3. Kick Player (Host only)
    socket.on(
      'kick-player',
      (
        data: { roomId: string; targetPlayerId: string },
        callback?: (res: any) => void
      ) => {
        const result = engine.kickPlayer(
          data.roomId,
          socket.id,
          data.targetPlayerId
        );
        if (result.success && result.targetSocketId) {
          io.to(result.targetSocketId).emit('error-message', {
            message: 'Bạn đã bị mời ra khỏi phòng bởi Host.',
          });
          const targetSocket = io.sockets.sockets.get(result.targetSocketId);
          if (targetSocket) {
            targetSocket.leave(data.roomId);
          }
          const updatedRoom = engine.getRoomById(data.roomId);
          if (updatedRoom) {
            io.to(data.roomId).emit('room-updated', updatedRoom);
          }
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false, error: result.error });
        }
      }
    );

    // 4. Start Game (Host only)
    socket.on(
      'start-game',
      (data: { roomId: string }, callback?: (res: any) => void) => {
        const result = engine.startGame(data.roomId, socket.id);
        if (result.success && result.room) {
          if (callback) callback({ success: true, room: result.room });
          io.to(data.roomId).emit('game-started', result.room);
          io.to(data.roomId).emit('leaderboard-updated', engine.getLeaderboard(data.roomId));
        } else {
          if (callback) callback({ success: false, error: result.error });
          socket.emit('error-message', { message: result.error });
        }
      }
    );

    // 5. Player Move
    socket.on('player-move', (payload: ClientMovePayload) => {
      const result = engine.handlePlayerMove(payload);

      if (!result.valid) {
        if (result.obstacleTriggered) {
          // Obstacle gate hit! Issue question directly to this player
          socket.emit('obstacle-triggered', {
            obstacleId: result.obstacleTriggered.obstacleId,
          });
          socket.emit(
            'question-issued',
            result.obstacleTriggered.questionIssued
          );
        }
        return;
      }

      if (result.player) {
        // Broadcast new position to all players in the room
        const update: PositionUpdatePayload = {
          playerId: result.player.id,
          x: result.player.x,
          y: result.player.y,
          progress: result.player.progress,
          activeEffects: result.player.activeEffects,
        };
        io.to(payload.roomId).emit('player-position-updated', update);

        // If picked up a powerup
        if (result.powerUpCollected) {
          socket.emit('power-up-collected', {
            powerUpType: result.powerUpCollected,
            inventory: result.player.inventory,
          });
        }

        // If player reached finish
        if (result.finished) {
          io.to(payload.roomId).emit('player-finished', {
            player: result.player,
            rank: result.player.rank,
          });

          // Check if entire game should finish
          const check = engine.checkGameCompletion(payload.roomId);
          if (check.completed && check.gameOverPayload) {
            io.to(payload.roomId).emit('game-over', check.gameOverPayload);
          } else {
            io.to(payload.roomId).emit(
              'leaderboard-updated',
              engine.getLeaderboard(payload.roomId)
            );
          }
        }
      }
    });

    // 6. Submit Answer
    socket.on('submit-answer', (payload: SubmitAnswerPayload) => {
      const result = engine.submitAnswer(payload);
      if (!result.success || !result.result || !result.player) {
        socket.emit('error-message', { message: result.error });
        return;
      }

      // Send result back to submitting player
      socket.emit('answer-result', result.result);

      if (result.result.isCorrect) {
        // Inform all that this obstacle gate is unlocked for this player
        io.to(payload.roomId).emit('obstacle-unlocked', {
          obstacleId: payload.obstacleId,
          playerId: payload.playerId,
        });

        // Broadcast position update with new progress
        io.to(payload.roomId).emit('player-position-updated', {
          playerId: result.player.id,
          x: result.player.x,
          y: result.player.y,
          progress: result.player.progress,
          activeEffects: result.player.activeEffects,
        });
      }

      // Update leaderboard
      io.to(payload.roomId).emit(
        'leaderboard-updated',
        engine.getLeaderboard(payload.roomId)
      );
    });

    // 7. Use Power-Up
    socket.on('use-power-up', (payload: UsePowerUpPayload) => {
      const result = engine.usePowerUp(payload);
      if (!result.success || !result.applied) {
        socket.emit('error-message', { message: result.error });
        return;
      }

      // Broadcast power up applied announcement
      io.to(payload.roomId).emit('power-up-applied', result.applied);

      // If source teleported, broadcast position
      if (result.teleportPos && result.sourcePlayer) {
        io.to(payload.roomId).emit('player-position-updated', {
          playerId: result.sourcePlayer.id,
          x: result.sourcePlayer.x,
          y: result.sourcePlayer.y,
          progress: result.sourcePlayer.progress,
          activeEffects: result.sourcePlayer.activeEffects,
        });
      }

      // If target status changed, broadcast target position/effects
      if (result.targetPlayer) {
        io.to(payload.roomId).emit('player-position-updated', {
          playerId: result.targetPlayer.id,
          x: result.targetPlayer.x,
          y: result.targetPlayer.y,
          progress: result.targetPlayer.progress,
          activeEffects: result.targetPlayer.activeEffects,
        });
      }

      // Send inventory update back to source
      if (result.sourcePlayer) {
        socket.emit('inventory-updated', {
          inventory: result.sourcePlayer.inventory,
        });
      }

      // Update leaderboard
      io.to(payload.roomId).emit(
        'leaderboard-updated',
        engine.getLeaderboard(payload.roomId)
      );
    });

    // 8. Pause Game (Host)
    socket.on('pause-game', (data: { roomId: string }) => {
      const res = engine.pauseGame(data.roomId, socket.id);
      if (res.success) {
        io.to(data.roomId).emit('game-paused', { roomId: data.roomId });
      }
    });

    // 9. Resume Game (Host)
    socket.on('resume-game', (data: { roomId: string }) => {
      const res = engine.resumeGame(data.roomId, socket.id);
      if (res.success) {
        io.to(data.roomId).emit('game-resumed', { roomId: data.roomId });
      }
    });

    // 10. End Game (Host)
    socket.on('end-game', (data: { roomId: string }) => {
      const res = engine.endGame(data.roomId, socket.id);
      if (res.success && res.gameOverPayload) {
        io.to(data.roomId).emit('game-over', res.gameOverPayload);
      }
    });

    // 11. Disconnect
    socket.on('disconnect', () => {
      const { room, player } = engine.handleDisconnect(socket.id);
      if (room && player) {
        io.to(room.id).emit('player-disconnected', {
          playerId: player.id,
          nickname: player.nickname,
        });
        io.to(room.id).emit('room-updated', room);
      }
    });
  });
}
