import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../game/GameEngine.js';
import { MazeGenerator } from '../game/MazeGenerator.js';
import { CellType } from '../types/game.js';

test('1. Maze Generator creates solvable maze with walls and paths', () => {
  const maze = MazeGenerator.generate('easy', ['q1', 'q2', 'q3']);
  assert.equal(maze.width, 37);
  assert.equal(maze.height, 37);
  assert.equal(maze.grid[maze.startPos.y][maze.startPos.x], CellType.START_TILE);
  assert.equal(maze.grid[maze.finishPos.y][maze.finishPos.x], CellType.FINISH_GATE);

  // Solvability check with BFS
  const path = MazeGenerator.findShortestPath(
    maze.grid,
    maze.startPos,
    maze.finishPos
  );
  assert.ok(path !== null, 'Maze must have a valid path from start to finish');
  assert.ok(path.length > 5, 'Path must be longer than trivial distance');
  assert.ok(maze.obstacleGates.length > 0, 'Obstacle gates must be placed');
});

test('2. Room creation and unique room code generation', () => {
  const engine = new GameEngine();
  const room1 = engine.createRoom('Teacher Anna', 'socket_host_1', 'Math Class', 'quiz-general-knowledge');
  const room2 = engine.createRoom('Teacher Bob', 'socket_host_2', 'Science Quiz', 'quiz-tech-and-coding');

  assert.ok(room1.id);
  assert.equal(room1.code.length, 6);
  assert.notEqual(room1.code, room2.code, 'Room codes must be unique');
  assert.equal(room1.status, 'LOBBY');
  assert.equal(Object.keys(room1.players).length, 1);
});

test('3. Player joining with code and max players limit', () => {
  const engine = new GameEngine();
  const room = engine.createRoom('Host', 's_host', 'Test Room', 'quiz-general-knowledge', {
    maxPlayers: 3,
  });

  // Join player 1
  const res1 = engine.joinRoom(room.code, 'Alice', 'fox', 's_alice');
  assert.ok(res1.player, 'Player Alice should join');
  assert.equal(res1.player.nickname, 'Alice');

  // Join player 2
  const res2 = engine.joinRoom(room.code, 'Bob', 'bear', 's_bob');
  assert.ok(res2.player, 'Player Bob should join');

  // Duplicate nickname rejected
  const resDup = engine.joinRoom(room.code, 'Alice', 'cat', 's_alice_dup');
  assert.ok(resDup.error, 'Duplicate nickname should be rejected');

  // Max players exceeded (Host + Alice + Bob = 3)
  const resMax = engine.joinRoom(room.code, 'Charlie', 'cat', 's_charlie');
  assert.ok(resMax.error, 'Exceeding max players must be rejected');
});

test('4. Disconnect and Reconnect handling', () => {
  const engine = new GameEngine();
  const room = engine.createRoom('Host', 's_host', 'Test Room', 'quiz-general-knowledge');
  const joinRes = engine.joinRoom(room.code, 'David', 'fox', 's_david');
  assert.ok(joinRes.player);

  // Disconnect
  const dc = engine.handleDisconnect('s_david');
  assert.equal(dc.player?.nickname, 'David');
  assert.equal(dc.player?.connected, false);

  // Reconnect with same nickname
  const reconn = engine.joinRoom(room.code, 'David', 'fox', 's_david_new_socket');
  assert.ok(reconn.player);
  assert.equal(reconn.player.connected, true);
  assert.equal(reconn.player.socketId, 's_david_new_socket');
});

test('5. Game start, movement validation and wall collisions', () => {
  const engine = new GameEngine();
  const room = engine.createRoom('Host', 's_host', 'Game Race', 'quiz-general-knowledge', {
    gameMode: 'practice', // allow 1 player
    difficulty: 'easy',
  });

  const startRes = engine.startGame(room.id, 's_host');
  assert.ok(startRes.success, 'Game should start');
  assert.equal(room.status, 'PLAYING');
  assert.ok(room.maze);

  const hostPlayer = Object.values(room.players)[0];
  const startX = hostPlayer.x;
  const startY = hostPlayer.y;

  // Illegal move: diagonal move
  const diagMove = engine.handlePlayerMove({
    roomId: room.id,
    playerId: hostPlayer.id,
    targetX: startX + 1,
    targetY: startY + 1,
    clientTime: Date.now(),
  });
  assert.equal(diagMove.valid, false, 'Diagonal move must be rejected');

  // Move into wall (0, 0 is a wall)
  const wallMove = engine.handlePlayerMove({
    roomId: room.id,
    playerId: hostPlayer.id,
    targetX: 0,
    targetY: 1,
    clientTime: Date.now(),
  });
  assert.equal(wallMove.valid, false, 'Moving into wall must be rejected');
});

test('6. Quiz Obstacle Gate and Answer validation', () => {
  const engine = new GameEngine();
  const room = engine.createRoom('Host', 's_host', 'Quiz Room', 'quiz-general-knowledge', {
    gameMode: 'practice',
    difficulty: 'easy',
  });
  engine.startGame(room.id, 's_host');
  const hostPlayer = Object.values(room.players)[0];
  const gate = room.maze!.obstacleGates[0];

  // Submit correct answer
  const correctRes = engine.submitAnswer({
    roomId: room.id,
    playerId: hostPlayer.id,
    obstacleId: gate.id,
    questionId: gate.questionId,
    selectedOptionId: 'B', // Let's check against actual question
    responseTimeMs: 2000,
  });

  assert.ok(correctRes.success);
  assert.equal(typeof correctRes.result?.isCorrect, 'boolean');

  // Submit wrong answer
  const wrongRes = engine.submitAnswer({
    roomId: room.id,
    playerId: hostPlayer.id,
    obstacleId: gate.id,
    questionId: gate.questionId,
    selectedOptionId: 'WRONG_ANSWER_KEY',
    responseTimeMs: 2500,
  });

  assert.ok(wrongRes.success);
  assert.equal(wrongRes.result?.isCorrect, false);
  assert.equal(wrongRes.result?.correctAnswer, '', 'Do not reveal correct answer on wrong submission');
  assert.equal(hostPlayer.wrongCount, 1);
  assert.ok(hostPlayer.activeEffects.freezeUntil! > Date.now(), 'Wrong answer applies penalty freeze');
});

test('7. Power-up inventory and execution (Ice Trap, Shield, Speed Boost)', () => {
  const engine = new GameEngine();
  const room = engine.createRoom('Host', 's_host', 'Power Room', 'quiz-general-knowledge', {
    gameMode: 'classic',
  });
  const p2 = engine.joinRoom(room.code, 'Rival', 'bear', 's_rival').player!;
  engine.startGame(room.id, 's_host');
  const p1 = Object.values(room.players).find((p) => p.isHost)!;

  // Add Shield to rival
  p2.inventory.push('shield');
  // Add Ice Trap to player 1
  p1.inventory.push('ice_trap');

  // P2 activates Shield
  const shieldRes = engine.usePowerUp({
    roomId: room.id,
    playerId: p2.id,
    powerUpType: 'shield',
  });
  assert.ok(shieldRes.success);
  assert.equal(p2.activeEffects.shieldActive, true);

  // P1 casts Ice Trap on P2 -> Shield should absorb it!
  const trapRes = engine.usePowerUp({
    roomId: room.id,
    playerId: p1.id,
    powerUpType: 'ice_trap',
    targetPlayerId: p2.id,
  });
  assert.ok(trapRes.success);
  assert.equal(trapRes.applied?.absorbedByShield, true, 'Shield must absorb the trap');
  assert.equal(p2.activeEffects.shieldActive, false, 'Shield should be consumed');
});

test('8. Host Pause, Resume, and Leaderboard export', () => {
  const engine = new GameEngine();
  const room = engine.createRoom('Host', 's_host', 'Room', 'quiz-general-knowledge', {
    gameMode: 'practice',
  });
  engine.startGame(room.id, 's_host');

  // Pause
  const pauseRes = engine.pauseGame(room.id, 's_host');
  assert.ok(pauseRes.success);
  assert.equal(room.status, 'PAUSED');

  // Resume
  const resumeRes = engine.resumeGame(room.id, 's_host');
  assert.ok(resumeRes.success);
  assert.equal(room.status, 'PLAYING');

  // Leaderboard
  const lb = engine.getLeaderboard(room.id);
  assert.ok(lb.length > 0);
  assert.equal(lb[0].rank, 1);
});

test('9. Host IP restriction allows only 192.168.50.117 & localhost or PIN', async () => {
  const { isAuthorizedHost } = await import('../utils/ipCheck.js');

  // Allowed Host IPs
  assert.equal(isAuthorizedHost('192.168.50.117').allowed, true, '192.168.50.117 must be authorized');
  assert.equal(isAuthorizedHost('127.0.0.1').allowed, true, 'localhost 127.0.0.1 must be authorized');
  assert.equal(isAuthorizedHost('::1').allowed, true, 'IPv6 localhost must be authorized');

  // Unauthorized Student IPs
  const student1 = isAuthorizedHost('192.168.50.45');
  assert.equal(student1.allowed, false, 'Other student IP 192.168.50.45 must be rejected');
  assert.ok(student1.reason?.includes('192.168.50.117'), 'Rejection reason must mention allowed host IP');

  const student2 = isAuthorizedHost('10.0.0.5');
  assert.equal(student2.allowed, false, 'Foreign IP must be rejected');

  // Override with Host Passcode
  const withPasscode = isAuthorizedHost('192.168.50.45', '12092211');
  assert.equal(withPasscode.allowed, true, 'Valid host passcode must grant access');
  assert.equal(isAuthorizedHost('192.168.50.45', 'wrong_pass').allowed, false, 'Wrong passcode must be rejected');
});

test('10. Match countdown timer and distance-to-finish ranking on timeout', () => {
  const engine = new GameEngine();
  const room = engine.createRoom('Host', 's_host', 'Timer Test Room', 'quiz-tthcm-cach-mang-mau', {
    gameDurationMinutes: 3,
  });

  const p1 = engine.joinRoom(room.code, 'Player Near Finish', 'fox', 's_near').player!;
  const p2 = engine.joinRoom(room.code, 'Player Far Finish', 'bear', 's_far').player!;

  const startRes = engine.startGame(room.id, 's_host');
  assert.ok(startRes.success);
  assert.equal(room.timeRemaining, 180, 'Time remaining should be 3 minutes = 180 seconds');

  // Place player 1 near finish
  p1.x = room.maze!.finishPos.x;
  p1.y = room.maze!.finishPos.y - 1; // 1 step from finish

  // Place player 2 far from finish
  p2.x = room.maze!.startPos.x;
  p2.y = room.maze!.startPos.y;

  // Check leaderboard ranking
  const lb1 = engine.getLeaderboard(room.id);
  const rankP1 = lb1.find((e) => e.playerId === p1.id)!;
  const rankP2 = lb1.find((e) => e.playerId === p2.id)!;

  assert.ok(rankP1.distanceToFinish! < rankP2.distanceToFinish!, 'P1 should be closer to finish');
  assert.ok(rankP1.rank < rankP2.rank, 'P1 should have better rank than P2 because P1 is closer to finish');

  // Trigger game timeout
  const timeoutRes = engine.handleGameTimeout(room.id);
  assert.ok(timeoutRes.success);
  assert.equal(timeoutRes.gameOverPayload?.endedReason, 'timeout');
  assert.equal(timeoutRes.gameOverPayload?.leaderboard[0].playerId, p1.id, 'P1 closest to finish should win rank 1 on timeout');
});

