import {
  CellType,
  MazeData,
  MazeDifficulty,
  MazeNPC,
  ObstacleGate,
  PowerUpSpawn,
  PowerUpType,
} from '../types/game.js';

interface Point {
  x: number;
  y: number;
}

export class MazeGenerator {
  /**
   * Generate a maze with guaranteed solvability, quiz obstacle gates, and power-up spawn locations
   */
  public static generate(
    difficulty: MazeDifficulty,
    questionIds: string[],
    playerIds?: string[]
  ): MazeData {
    // Ultra-challenging, large maze configurations:
    // Plentiful obstacle gates across main paths and branches + 12 patrolling NPCs!
    let width = 37;
    let height = 37;
    let mainGateCount = 28;
    let sideGateCount = 25;
    let powerUpCount = 10;
    let npcCount = 12;

    if (difficulty === 'medium') {
      width = 43;
      height = 43;
      mainGateCount = 35;
      sideGateCount = 30;
      powerUpCount = 12;
      npcCount = 12;
    } else if (difficulty === 'hard') {
      width = 49;
      height = 49;
      mainGateCount = 42;
      sideGateCount = 38;
      powerUpCount = 14;
      npcCount = 14;
    }

    // Ensure odd dimensions for proper wall-corridor grid
    if (width % 2 === 0) width++;
    if (height % 2 === 0) height++;

    // 1. Initialize grid with all walls
    const grid: number[][] = Array.from({ length: height }, () =>
      Array(width).fill(CellType.WALL)
    );

    // 2. Recursive Backtracking Maze Carving
    const startX = 1;
    const startY = 1;
    grid[startY][startX] = CellType.PATH;

    const stack: Point[] = [{ x: startX, y: startY }];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    const directions = [
      { dx: 0, dy: -2 }, // Up
      { dx: 0, dy: 2 },  // Down
      { dx: -2, dy: 0 }, // Left
      { dx: 2, dy: 0 },  // Right
    ];

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors: { next: Point; between: Point }[] = [];

      // Shuffle directions for organic maze shapes
      const shuffled = [...directions].sort(() => Math.random() - 0.5);

      for (const dir of shuffled) {
        const nx = current.x + dir.dx;
        const ny = current.y + dir.dy;

        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1) {
          if (!visited.has(`${nx},${ny}`)) {
            neighbors.push({
              next: { x: nx, y: ny },
              between: { x: current.x + dir.dx / 2, y: current.y + dir.dy / 2 },
            });
          }
        }
      }

      if (neighbors.length > 0) {
        const chosen = neighbors[0];
        grid[chosen.between.y][chosen.between.x] = CellType.PATH;
        grid[chosen.next.y][chosen.next.x] = CellType.PATH;
        visited.add(`${chosen.next.x},${chosen.next.y}`);
        stack.push(chosen.next);
      } else {
        stack.pop();
      }
    }

    // 3. Define Start and Finish points
    const startPos: Point = { x: 1, y: 1 };
    const finishPos: Point = { x: width - 2, y: height - 2 };
    grid[startPos.y][startPos.x] = CellType.START_TILE;
    grid[finishPos.y][finishPos.x] = CellType.FINISH_GATE;

    // 4. Compute shortest path from Start to Finish using BFS (Critical Path)
    const shortestPath = this.findShortestPath(grid, startPos, finishPos);
    if (!shortestPath || shortestPath.length === 0) {
      grid[finishPos.y][finishPos.x] = CellType.FINISH_GATE;
    }

    const pathPoints = shortestPath && shortestPath.length > 2
      ? shortestPath.slice(1, shortestPath.length - 1)
      : [];

    // 5. Identify side branch candidates for gates & powerups
    const branchCandidates: Point[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (
          grid[y][x] === CellType.PATH &&
          (x !== startPos.x || y !== startPos.y) &&
          (x !== finishPos.x || y !== finishPos.y)
        ) {
          branchCandidates.push({ x, y });
        }
      }
    }
    branchCandidates.sort(() => Math.random() - 0.5);

    // 6. Place Obstacle Gates: Personal & randomized for each player
    // Every route to the finish requires passing at least 8 obstacle gates!
    const obstacleGates: ObstacleGate[] = [];
    const availableQuestionIds = [...questionIds].sort(() => Math.random() - 0.5);
    const getNextQuestionId = (idx: number) => {
      if (availableQuestionIds.length === 0) return `q_${idx + 1}`;
      return availableQuestionIds[idx % availableQuestionIds.length];
    };

    const MANDATORY_PATH_GATES = 8;

    if (playerIds && playerIds.length > 0) {
      // Generate per-player randomized gates for each player
      playerIds.forEach((pId) => {
        // A. At least 8 mandatory gates along the critical path to finish
        if (pathPoints.length >= MANDATORY_PATH_GATES) {
          const segSize = Math.floor(pathPoints.length / MANDATORY_PATH_GATES);
          for (let i = 0; i < MANDATORY_PATH_GATES; i++) {
            const segStart = i * segSize;
            const segEnd = i === MANDATORY_PATH_GATES - 1 ? pathPoints.length - 1 : (i + 1) * segSize - 1;
            const jitter = Math.floor(Math.random() * Math.max(1, segEnd - segStart));
            const ptIdx = Math.min(pathPoints.length - 1, segStart + jitter);
            const pt = pathPoints[ptIdx];

            obstacleGates.push({
              id: `gate_${pId}_m_${i + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              x: pt.x,
              y: pt.y,
              questionId: getNextQuestionId(obstacleGates.length),
              unlockedBy: [],
              playerId: pId,
            });
          }
        }

        // B. Plentiful randomized side-branch obstacle gates for this player
        const sideCount = Math.min(sideGateCount, Math.max(12, branchCandidates.length));
        const shuffledBranches = [...branchCandidates].sort(() => Math.random() - 0.5);
        for (let i = 0; i < Math.min(sideCount, shuffledBranches.length); i++) {
          const pt = shuffledBranches[i];
          obstacleGates.push({
            id: `gate_${pId}_s_${i + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            x: pt.x,
            y: pt.y,
            questionId: getNextQuestionId(obstacleGates.length),
            unlockedBy: [],
            playerId: pId,
          });
        }
      });
    } else {
      // Legacy / Shared Gates (when no specific playerIds provided, e.g. tests or solo)
      const targetMainGates = Math.min(mainGateCount, pathPoints.length);
      const usedGateCoords = new Set<string>();

      if (pathPoints.length >= targetMainGates && targetMainGates > 0) {
        const step = pathPoints.length / (targetMainGates + 1);
        for (let i = 1; i <= targetMainGates; i++) {
          let ptIndex = Math.min(Math.round(i * step), pathPoints.length - 1);
          while (ptIndex > 0 && usedGateCoords.has(`${pathPoints[ptIndex].x},${pathPoints[ptIndex].y}`)) {
            ptIndex--;
          }
          const pt = pathPoints[ptIndex];
          const key = `${pt.x},${pt.y}`;
          if (
            !usedGateCoords.has(key) &&
            (pt.x !== startPos.x || pt.y !== startPos.y) &&
            (pt.x !== finishPos.x || pt.y !== finishPos.y)
          ) {
            usedGateCoords.add(key);
            grid[pt.y][pt.x] = CellType.OBSTACLE_GATE;
            obstacleGates.push({
              id: `gate_${obstacleGates.length + 1}`,
              x: pt.x,
              y: pt.y,
              questionId: getNextQuestionId(obstacleGates.length),
              unlockedBy: [],
            });
          }
        }
      }

      const sideGatesToPlace = Math.min(sideGateCount, branchCandidates.length);
      for (let i = 0; i < sideGatesToPlace; i++) {
        const pt = branchCandidates[i];
        if (!usedGateCoords.has(`${pt.x},${pt.y}`)) {
          usedGateCoords.add(`${pt.x},${pt.y}`);
          grid[pt.y][pt.x] = CellType.OBSTACLE_GATE;
          obstacleGates.push({
            id: `gate_${obstacleGates.length + 1}`,
            x: pt.x,
            y: pt.y,
            questionId: getNextQuestionId(obstacleGates.length),
            unlockedBy: [],
          });
        }
      }
    }

    // 7. Place PowerUp mystery boxes in remaining corridors
    const powerUpTypes: PowerUpType[] = [
      'ice_trap',
      'speed_boost',
      'shield',
      'reveal_path',
      'teleport',
      'time_freeze',
      'lucky_key',
      'time_attack',
    ];

    const powerUpSpawns: PowerUpSpawn[] = [];
    const selectedCorridors = branchCandidates.slice(0, powerUpCount);

    selectedCorridors.forEach((pt, idx) => {
      const pType = powerUpTypes[idx % powerUpTypes.length];
      grid[pt.y][pt.x] = CellType.POWERUP_BOX;
      powerUpSpawns.push({
        id: `power_${idx + 1}`,
        x: pt.x,
        y: pt.y,
        type: pType,
        collectedBy: [],
      });
    });

    // 8. Spawn 12 Wandering Patrolling NPCs with 5-Second Stun Ability
    const npcTiles = branchCandidates
      .slice(powerUpCount)
      .filter((pt) => Math.abs(pt.x - startPos.x) + Math.abs(pt.y - startPos.y) > 5);

    const npcDefinitions = [
      { name: 'Robot Tuần Tra X-1', icon: '🤖', color: '#ef4444' },
      { name: 'Vệ Binh Bóng Đêm', icon: '👾', color: '#a855f7' },
      { name: 'Bóng Ma Tri Thức', icon: '👻', color: '#06b6d4' },
      { name: 'Cảnh Vệ Mê Cung', icon: '👺', color: '#f97316' },
      { name: 'Dơi Quỷ Săn Đêm', icon: '🦇', color: '#ec4899' },
      { name: 'Chiến Binh Tử Thần', icon: '💀', color: '#eab308' },
      { name: 'Đĩa Bay Cyber U-2', icon: '🛸', color: '#10b981' },
      { name: 'Sinh Vật Ngoại Lai', icon: '👽', color: '#6366f1' },
      { name: 'Nhện Độc Cổ Đại', icon: '🕷️', color: '#f43f5e' },
      { name: 'Xác Sống Mê Cung', icon: '🧟', color: '#84cc16' },
      { name: 'Hiệp Sĩ Gai Thép', icon: '⚔️', color: '#38bdf8' },
      { name: 'Quỷ Dạ Xoa Xích Lô', icon: '👹', color: '#fb923c' },
    ];

    const npcs: MazeNPC[] = [];
    const targetNpcCount = Math.min(npcCount, npcTiles.length);
    for (let i = 0; i < targetNpcCount; i++) {
      const pt = npcTiles[i];
      const def = npcDefinitions[i % npcDefinitions.length];
      npcs.push({
        id: `npc_${i + 1}`,
        name: def.name,
        x: pt.x,
        y: pt.y,
        type: 'patrol',
        icon: def.icon,
        color: def.color,
        dx: i % 2 === 0 ? 1 : 0,
        dy: i % 2 === 0 ? 0 : 1,
      });
    }

    return {
      width,
      height,
      grid,
      startPos,
      finishPos,
      obstacleGates,
      powerUpSpawns,
      npcs,
      shortestPathLength: shortestPath ? shortestPath.length : width + height,
    };
  }

  /**
   * Helper to generate personalized obstacle gates for a newly joined player
   */
  public static generatePlayerGates(
    maze: MazeData,
    playerId: string,
    questionIds: string[]
  ): ObstacleGate[] {
    const shortestPath = this.findShortestPath(maze.grid, maze.startPos, maze.finishPos);
    const pathPoints = shortestPath && shortestPath.length > 2
      ? shortestPath.slice(1, shortestPath.length - 1)
      : [];

    const MANDATORY_PATH_GATES = 8;
    const newGates: ObstacleGate[] = [];
    const availableQuestionIds = [...questionIds].sort(() => Math.random() - 0.5);
    const getNextQuestionId = (idx: number) => {
      if (availableQuestionIds.length === 0) return `q_${idx + 1}`;
      return availableQuestionIds[idx % availableQuestionIds.length];
    };

    if (pathPoints.length >= MANDATORY_PATH_GATES) {
      const segSize = Math.floor(pathPoints.length / MANDATORY_PATH_GATES);
      for (let i = 0; i < MANDATORY_PATH_GATES; i++) {
        const segStart = i * segSize;
        const segEnd = i === MANDATORY_PATH_GATES - 1 ? pathPoints.length - 1 : (i + 1) * segSize - 1;
        const jitter = Math.floor(Math.random() * Math.max(1, segEnd - segStart));
        const ptIdx = Math.min(pathPoints.length - 1, segStart + jitter);
        const pt = pathPoints[ptIdx];

        newGates.push({
          id: `gate_${playerId}_m_${i + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          x: pt.x,
          y: pt.y,
          questionId: getNextQuestionId(newGates.length),
          unlockedBy: [],
          playerId,
        });
      }
    }

    // Branch gates
    const branches: Point[] = [];
    for (let y = 1; y < maze.height - 1; y++) {
      for (let x = 1; x < maze.width - 1; x++) {
        if (
          maze.grid[y][x] === CellType.PATH &&
          (x !== maze.startPos.x || y !== maze.startPos.y) &&
          (x !== maze.finishPos.x || y !== maze.finishPos.y)
        ) {
          branches.push({ x, y });
        }
      }
    }
    branches.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(18, branches.length); i++) {
      const pt = branches[i];
      newGates.push({
        id: `gate_${playerId}_s_${i + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        x: pt.x,
        y: pt.y,
        questionId: getNextQuestionId(newGates.length),
        unlockedBy: [],
        playerId,
      });
    }

    return newGates;
  }

  /**
   * Breadth-First Search to find shortest path on grid
   */
  public static findShortestPath(
    grid: number[][],
    start: Point,
    end: Point
  ): Point[] | null {
    const height = grid.length;
    const width = grid[0].length;
    const queue: { point: Point; path: Point[] }[] = [
      { point: start, path: [start] },
    ];
    const visited = new Set<string>();
    visited.add(`${start.x},${start.y}`);

    const dirs = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];

    while (queue.length > 0) {
      const { point, path } = queue.shift()!;

      if (point.x === end.x && point.y === end.y) {
        return path;
      }

      for (const d of dirs) {
        const nx = point.x + d.dx;
        const ny = point.y + d.dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          // Can walk through PATH, START, FINISH, OBSTACLE_GATE, POWERUP_BOX (everything except WALL)
          if (grid[ny][nx] !== CellType.WALL && !visited.has(`${nx},${ny}`)) {
            visited.add(`${nx},${ny}`);
            queue.push({
              point: { x: nx, y: ny },
              path: [...path, { x: nx, y: ny }],
            });
          }
        }
      }
    }

    return null;
  }

  /**
   * Calculate progress percentage (0 - 100%) from start to finish
   */
  public static calculateProgress(
    current: Point,
    start: Point,
    finish: Point,
    shortestPath: Point[] | null
  ): number {
    if (current.x === finish.x && current.y === finish.y) return 100;
    if (current.x === start.x && current.y === start.y) return 0;

    // If shortest path is known, find closest path node index
    if (shortestPath && shortestPath.length > 1) {
      let closestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < shortestPath.length; i++) {
        const pt = shortestPath[i];
        const dist = Math.abs(current.x - pt.x) + Math.abs(current.y - pt.y);
        if (dist < minDistance) {
          minDistance = dist;
          closestIdx = i;
        }
      }

      const progress = Math.min(
        99,
        Math.round((closestIdx / (shortestPath.length - 1)) * 100)
      );
      return progress;
    }

    // Manhattan distance fallback
    const totalDist =
      Math.abs(finish.x - start.x) + Math.abs(finish.y - start.y);
    const remainingDist =
      Math.abs(finish.x - current.x) + Math.abs(finish.y - current.y);
    const progress = Math.max(
      0,
      Math.min(99, Math.round(((totalDist - remainingDist) / totalDist) * 100))
    );
    return progress;
  }
}
