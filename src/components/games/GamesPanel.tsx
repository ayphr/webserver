import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../common';
import {
  IconAppleFilled,
  IconBomb,
  IconCircleDotFilled,
  IconCircleFilled,
  IconDiamondFilled,
  IconFlagFilled,
  IconHexagonFilled,
  IconSquareFilled,
  IconStarFilled,
  IconTriangleFilled,
} from '@tabler/icons-react';
import './GamesPanel.css';

type GameId = 'menu' | 'memory' | 'minesweeper' | 'snake';

export function GamesPanel() {
  const [game, setGame] = useState<GameId>('menu');

  return (
    <div className="games-panel">
      {game !== 'menu' && (
        <div className="games-panel__back">
          <Button variant="secondary" onClick={() => setGame('menu')}>
            Back to menu
          </Button>
        </div>
      )}

      <div className="games-panel__body">
        {game === 'menu' && (
          <div className="games-panel__menu">
            <p className="games-panel__intro">
              Pick a game to play. Everything runs locally in your browser.
            </p>
            <div className="games-panel__menu-grid">
              <button className="games-panel__menu-card" onClick={() => setGame('memory')}>
                <span className="games-panel__menu-title">Card Match</span>
                <span className="games-panel__menu-desc">Flip cards and match coloured shapes.</span>
              </button>
              <button className="games-panel__menu-card" onClick={() => setGame('minesweeper')}>
                <span className="games-panel__menu-title">Minesweeper</span>
                <span className="games-panel__menu-desc">Clear the board without hitting a mine.</span>
              </button>
              <button className="games-panel__menu-card" onClick={() => setGame('snake')}>
                <span className="games-panel__menu-title">Snake</span>
                <span className="games-panel__menu-desc">Eat, grow, and avoid crashing.</span>
              </button>
            </div>
          </div>
        )}

        {game === 'memory' && <MemoryGame />}
        {game === 'minesweeper' && <MinesweeperGame />}
        {game === 'snake' && <SnakeGame />}
      </div>
    </div>
  );
}

/* ---------------- Memory game ---------------- */

type Shape = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon';

interface MemoryCard {
  id: number;
  shape: Shape;
  color: string;
  matched: boolean;
  flipped: boolean;
}

const MEMORY_PAIRS: { shape: Shape; color: string }[] = [
  { shape: 'circle', color: '#ff6b6b' },
  { shape: 'square', color: '#4dabf7' },
  { shape: 'triangle', color: '#51cf66' },
  { shape: 'diamond', color: '#fcc419' },
  { shape: 'star', color: '#cc5de8' },
  { shape: 'hexagon', color: '#ff922b' },
  { shape: 'circle', color: '#20c997' },
  { shape: 'square', color: '#748ffc' },
];

const SHAPE_ICONS: Record<Shape, typeof IconCircleFilled> = {
  circle: IconCircleFilled,
  square: IconSquareFilled,
  triangle: IconTriangleFilled,
  diamond: IconDiamondFilled,
  star: IconStarFilled,
  hexagon: IconHexagonFilled,
};

function ShapeIcon({ shape, color }: { shape: Shape; color: string }) {
  const Icon = SHAPE_ICONS[shape];
  return <Icon size={40} style={{ color }} />;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createMemoryCards(): MemoryCard[] {
  const doubled = MEMORY_PAIRS.flatMap((pair, index) => [
    { id: index * 2, ...pair, matched: false, flipped: false },
    { id: index * 2 + 1, ...pair, matched: false, flipped: false },
  ]);
  return shuffle(doubled).map((card, index) => ({ ...card, id: index }));
}

function MemoryGame() {
  const [cards, setCards] = useState<MemoryCard[]>(() => createMemoryCards());
  const [flipped, setFlipped] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [locked, setLocked] = useState(false);

  const matchedCount = cards.filter((c) => c.matched).length;

  const handleFlip = (index: number) => {
    if (locked) return;
    const card = cards[index];
    if (card.matched || card.flipped) return;
    if (flipped.length >= 2) return;

    if (flipped.length === 0) {
      setCards((prev) =>
        prev.map((c, i) => (i === index ? { ...c, flipped: true } : c))
      );
      setFlipped([index]);
      return;
    }

    const firstIndex = flipped[0];
    const firstCard = cards[firstIndex];
    const secondCard = cards[index];
    const isMatch = firstCard.shape === secondCard.shape && firstCard.color === secondCard.color;

    setLocked(true);
    setMoves((m) => m + 1);
    setCards((prev) =>
      prev.map((c, i) => (i === index ? { ...c, flipped: true } : c))
    );

    if (isMatch) {
      setCards((prev) =>
        prev.map((c, i) =>
          i === firstIndex || i === index ? { ...c, matched: true, flipped: true } : c
        )
      );
      setFlipped([]);
      setLocked(false);
    } else {
      window.setTimeout(() => {
        setCards((prev) =>
          prev.map((c, i) =>
            i === firstIndex || i === index ? { ...c, flipped: false } : c
          )
        );
        setFlipped([]);
        setLocked(false);
      }, 800);
    }
  };

  const reset = () => {
    setCards(createMemoryCards());
    setFlipped([]);
    setMoves(0);
    setLocked(false);
  };

  return (
    <div className="game-memory">
      <div className="game-memory__status">
        <span>Moves: {moves}</span>
        <span>Matched: {matchedCount / 2} / {MEMORY_PAIRS.length}</span>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
      </div>
      <div className="game-memory__grid">
        {cards.map((card, index) => (
          <button
            key={card.id}
            className={`memory-card ${card.flipped || card.matched ? 'memory-card--flipped' : ''} ${
              card.matched ? 'memory-card--matched' : ''
            }`}
            onClick={() => handleFlip(index)}
            disabled={card.matched}
          >
            <span className="memory-card__inner">
              <span className="memory-card__face memory-card__face--front">
                <ShapeIcon shape={card.shape} color={card.color} />
              </span>
              <span className="memory-card__face memory-card__face--back">?</span>
            </span>
          </button>
        ))}
      </div>
      {matchedCount === cards.length && cards.length > 0 && (
        <p className="game-memory__win">You won in {moves} moves!</p>
      )}
    </div>
  );
}

/* ---------------- Minesweeper ---------------- */

const MS_SIZE = 9;
const MS_MINES = 10;

interface MsCell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
}

function createEmptyMsBoard(): MsCell[][] {
  return Array.from({ length: MS_SIZE }, () =>
    Array.from({ length: MS_SIZE }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
    }))
  );
}

function placeMines(board: MsCell[][], safeR: number, safeC: number) {
  const forbidden = new Set<string>();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = safeR + dr;
      const c = safeC + dc;
      if (r >= 0 && r < MS_SIZE && c >= 0 && c < MS_SIZE) {
        forbidden.add(`${r},${c}`);
      }
    }
  }
  let placed = 0;
  while (placed < MS_MINES) {
    const r = Math.floor(Math.random() * MS_SIZE);
    const c = Math.floor(Math.random() * MS_SIZE);
    if (forbidden.has(`${r},${c}`)) continue;
    if (board[r][c].mine) continue;
    board[r][c].mine = true;
    placed++;
  }
  for (let r = 0; r < MS_SIZE; r++) {
    for (let c = 0; c < MS_SIZE; c++) {
      if (board[r][c].mine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < MS_SIZE && nc >= 0 && nc < MS_SIZE && board[nr][nc].mine) {
            count++;
          }
        }
      }
      board[r][c].adjacent = count;
    }
  }
}

function cloneMsBoard(board: MsCell[][]): MsCell[][] {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

function floodReveal(board: MsCell[][], r: number, c: number) {
  if (r < 0 || r >= MS_SIZE || c < 0 || c >= MS_SIZE) return;
  const cell = board[r][c];
  if (cell.revealed || cell.flagged || cell.mine) return;
  cell.revealed = true;
  if (cell.adjacent === 0) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        floodReveal(board, r + dr, c + dc);
      }
    }
  }
}

function MinesweeperGame() {
  const [board, setBoard] = useState<MsCell[][]>(() => createEmptyMsBoard());
  const [status, setStatus] = useState<'idle' | 'playing' | 'won' | 'lost'>('idle');
  const [firstClick, setFirstClick] = useState(true);
  const [flagCount, setFlagCount] = useState(0);

  const reset = () => {
    setBoard(createEmptyMsBoard());
    setStatus('idle');
    setFirstClick(true);
    setFlagCount(0);
  };

  const handleReveal = (r: number, c: number) => {
    if (status === 'won' || status === 'lost') return;
    const cell = board[r][c];
    if (cell.revealed || cell.flagged) return;

    const working = cloneMsBoard(board);

    if (firstClick) {
      placeMines(working, r, c);
      setFirstClick(false);
    }

    if (working[r][c].mine) {
      working[r][c].revealed = true;
      // reveal all mines
      working.forEach((row) => row.forEach((cl) => {
        if (cl.mine) cl.revealed = true;
      }));
      setBoard(working);
      setStatus('lost');
      return;
    }

    floodReveal(working, r, c);
    setBoard(working);

    const won = working.flat().every((cl) => cl.mine || cl.revealed);
    if (won) setStatus('won');
    else setStatus('playing');
  };

  const handleFlag = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (status === 'won' || status === 'lost') return;
    const cell = board[r][c];
    if (cell.revealed) return;
    const nextFlagged = !cell.flagged;
    setBoard((prev) => {
      const b = cloneMsBoard(prev);
      b[r][c].flagged = nextFlagged;
      return b;
    });
    setFlagCount((n) => (nextFlagged ? n + 1 : n - 1));
    if (status === 'idle') setStatus('playing');
  };

  const adjacentColor = (n: number) => {
    const colors = ['', '#4dabf7', '#51cf66', '#ff6b6b', '#748ffc', '#cc5de8', '#20c997', '#fcc419', '#ff922b'];
    return colors[n] ?? '#fff';
  };

  return (
    <div className="game-minesweeper">
      <div className="game-minesweeper__status">
        <span>Mines: {MS_MINES - flagCount}</span>
        <span>
          {status === 'won' ? 'You won!' : status === 'lost' ? 'Game over' : 'Playing'}
        </span>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
      </div>
      <div className="ms-grid">
        {board.map((row, r) =>
          row.map((cell, c) => (
            <button
              key={`${r}-${c}`}
              className={`ms-cell ${cell.revealed ? 'ms-cell--revealed' : ''} ${
                cell.mine && cell.revealed ? 'ms-cell--mine' : ''
              }`}
              onClick={() => handleReveal(r, c)}
              onContextMenu={(e) => handleFlag(e, r, c)}
            >
              {cell.revealed
                ? cell.mine
                  ? <IconBomb size={18} />
                  : cell.adjacent > 0
                  ? <span style={{ color: adjacentColor(cell.adjacent), fontWeight: 700 }}>{cell.adjacent}</span>
                  : ''
                : cell.flagged
                ? <IconFlagFilled size={16} style={{ color: '#fcc419' }} />
                : ''}
            </button>
          ))
        )}
      </div>
      <p className="game-minesweeper__hint">Left click to reveal, right click to flag.</p>
    </div>
  );
}

/* ---------------- Snake ---------------- */

const SNAKE_SIZE = 20;
type Point = { x: number; y: number };
type Direction = 'up' | 'down' | 'left' | 'right';

function SnakeGame() {
  const [snake, setSnake] = useState<Point[]>([{ x: 10, y: 10 }]);
  const [food, setFood] = useState<Point>({ x: 5, y: 5 });
  const [direction, setDirection] = useState<Direction>('right');
  const [status, setStatus] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);

  const directionRef = useRef(direction);
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  const randomFood = useCallback((currentSnake: Point[]) => {
    const occupied = new Set(currentSnake.map((p) => `${p.x},${p.y}`));
    let pos: Point;
    do {
      pos = {
        x: Math.floor(Math.random() * SNAKE_SIZE),
        y: Math.floor(Math.random() * SNAKE_SIZE),
      };
    } while (occupied.has(`${pos.x},${pos.y}`));
    return pos;
  }, []);

  const reset = () => {
    const initial = [{ x: 10, y: 10 }];
    setSnake(initial);
    setFood(randomFood(initial));
    setDirection('right');
    setStatus('idle');
    setScore(0);
  };

  useEffect(() => {
    if (status !== 'playing') return;
    const interval = setInterval(() => {
      setSnake((prev) => {
        const head = prev[0];
        const dir = directionRef.current;
        const next: Point = { ...head };
        if (dir === 'up') next.y -= 1;
        if (dir === 'down') next.y += 1;
        if (dir === 'left') next.x -= 1;
        if (dir === 'right') next.x += 1;

        // collision with wall
        if (next.x < 0 || next.x >= SNAKE_SIZE || next.y < 0 || next.y >= SNAKE_SIZE) {
          setStatus('gameover');
          return prev;
        }
        // collision with self
        if (prev.some((p) => p.x === next.x && p.y === next.y)) {
          setStatus('gameover');
          return prev;
        }

        const newSnake = [next, ...prev];
        if (next.x === food.x && next.y === food.y) {
          setScore((s) => s + 1);
          setFood(randomFood(newSnake));
        } else {
          newSnake.pop();
        }
        return newSnake;
      });
    }, 120);
    return () => clearInterval(interval);
  }, [status, food, randomFood]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      let newDir: Direction | null = null;
      if (key === 'arrowup' || key === 'w') newDir = 'up';
      if (key === 'arrowdown' || key === 's') newDir = 'down';
      if (key === 'arrowleft' || key === 'a') newDir = 'left';
      if (key === 'arrowright' || key === 'd') newDir = 'right';
      if (!newDir) return;
      e.preventDefault();

      const opposite: Record<Direction, Direction> = {
        up: 'down',
        down: 'up',
        left: 'right',
        right: 'left',
      };
      if (newDir === opposite[directionRef.current]) return;

      if (status === 'idle') setStatus('playing');
      if (status === 'gameover') return;
      setDirection(newDir);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status]);

  const snakeSet = new Set(snake.map((p) => `${p.x},${p.y}`));

  return (
    <div className="game-snake">
      <div className="game-snake__status">
        <span>Score: {score}</span>
        <span>
          {status === 'idle'
            ? 'Press an arrow key to start'
            : status === 'gameover'
            ? 'Game over'
            : 'Playing'}
        </span>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
      </div>
      <div className="snake-grid">
        {Array.from({ length: SNAKE_SIZE * SNAKE_SIZE }).map((_, i) => {
          const x = i % SNAKE_SIZE;
          const y = Math.floor(i / SNAKE_SIZE);
          const isHead = snake[0].x === x && snake[0].y === y;
          const isBody = !isHead && snakeSet.has(`${x},${y}`);
          const isFood = food.x === x && food.y === y;
          return (
            <div
              key={i}
              className={`snake-cell ${isHead ? 'snake-cell--head' : ''} ${
                isBody ? 'snake-cell--body' : ''
              } ${isFood ? 'snake-cell--food' : ''}`}
            >
              {isHead ? (
                <IconCircleDotFilled size={14} />
              ) : isFood ? (
                <IconAppleFilled size={14} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}