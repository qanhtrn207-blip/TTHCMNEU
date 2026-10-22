import {
  CellType,
  MazeData,
  MazeDifficulty,
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
    questionIds: string[]
  ): MazeData {
    // Ultra-challenging, large maze configurations:
    // Guarantees players must answer AT LEAST 25 questions on the critical path to finish!
    let width = 37;
    let height = 37;
    let gateCount = 25;
    let powerUpCount = 10;

    if (difficulty === 'medium') {
      width = 43;
      height = 43;
      gateCount = 26;
      powerUpCount = 12;
    } else if (difficulty === 'hard') {
      width = 49;
      height = 49;
      gateCount = 28;
      powerUpCount = 14;
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

    // 5. Strategically place Obstacle Gates along the critical path
    // Because no bypass loops are created, players MUST unlock all gates to finish!
    const obstacleGates: ObstacleGate[] = [];
    const availableQuestionIds = [...questionIds];
    const getNextQuestionId = (idx: number) => {
      if (availableQuestionIds.length === 0) return `q_${idx + 1}`;
      return availableQuestionIds[idx % availableQuestionIds.length];
    };

    const targetGates = Math.min(gateCount, pathPoints.length);
    const usedGateCoords = new Set<string>();

    if (pathPoints.length >= targetGates && targetGates > 0) {
      const step = pathPoints.length / (targetGates + 1);

      for (let i = 1; i <= targetGates; i++) {
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

    // 7. Place PowerUp mystery boxes in alcoves and side corridors
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
    const gatePositions = new Set(obstacleGates.map((g) => `${g.x},${g.y}`));
    const emptyCorridors: Point[] = [];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (
          grid[y][x] === CellType.PATH &&
          !gatePositions.has(`${x},${y}`) &&
          (x !== startPos.x || y !== startPos.y) &&
          (x !== finishPos.x || y !== finishPos.y)
        ) {
          emptyCorridors.push({ x, y });
        }
      }
    }

    // Shuffle and pick power up spawn points
    emptyCorridors.sort(() => Math.random() - 0.5);
    const selectedCorridors = emptyCorridors.slice(0, powerUpCount);

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

    return {
      width,
      height,
      grid,
      startPos,
      finishPos,
      obstacleGates,
      powerUpSpawns,
      shortestPathLength: shortestPath ? shortestPath.length : width + height,
    };
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
