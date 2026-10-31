import { useEffect, useState } from 'react';
import { Button } from '../common';
import { api } from '../../lib/api';
import {
  IconBomb,
  IconCircleFilled,
  IconDiamondFilled,
  IconFlagFilled,
  IconFlowerFilled,
  IconHeartFilled,
  IconHexagonFilled,
  IconSquareFilled,
  IconStarFilled,
  IconTriangleFilled,
} from '@tabler/icons-react';
import './GamesPanel.css';

type GameId = 'menu' | 'memory' | 'minesweeper';

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
            <p className="games-panel__intro">Pick a game to play.</p>
            <div className="games-panel__menu-grid">
              <button className="games-panel__menu-card" onClick={() => setGame('memory')}>
                <span className="games-panel__menu-title">Card Match</span>
                <span className="games-panel__menu-desc">Flip cards and match coloured shapes.</span>
              </button>
              <button className="games-panel__menu-card" onClick={() => setGame('minesweeper')}>
                <span className="games-panel__menu-title">Minesweeper</span>
                <span className="games-panel__menu-desc">Clear the board without hitting a mine.</span>
              </button>
            </div>
          </div>
        )}

        {game === 'memory' && <MemoryGame />}
        {game === 'minesweeper' && <MinesweeperGame />}
      </div>
    </div>
  );
}

type Shape = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon' | 'heart' | 'flower';

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
  { shape: 'heart', color: '#20c997' },
  { shape: 'flower', color: '#748ffc' },
];

const SHAPE_ICONS: Record<Shape, typeof IconCircleFilled> = {
  circle: IconCircleFilled,
  square: IconSquareFilled,
  triangle: IconTriangleFilled,
  diamond: IconDiamondFilled,
  star: IconStarFilled,
  hexagon: IconHexagonFilled,
  heart: IconHeartFilled,
  flower: IconFlowerFilled,
};

function ShapeIcon({ shape, color }: Readonly<{ shape: Shape; color: string }>) {
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
  const [bestMoves, setBestMoves] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    api.games
      .getBests()
      .then((res) => {
        if (active) setBestMoves(res.bests.memory?.value ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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

      const newMoves = moves + 1;
      if (matchedCount + 2 === cards.length) {
        if (bestMoves === null || newMoves < bestMoves) {
          api.games
            .updateBest('memory', newMoves)
            .then((res) => setBestMoves(res.bests.memory?.value ?? newMoves))
            .catch(() => {});
        }
      }
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
        <span>Best: {bestMoves ?? '-'}</span>
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
  const [elapsed, setElapsed] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    api.games
      .getBests()
      .then((res) => {
        if (active) setBestTime(res.bests.minesweeper?.value ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const reset = () => {
    setBoard(createEmptyMsBoard());
    setStatus('idle');
    setFirstClick(true);
    setFlagCount(0);
    setElapsed(0);
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
    if (won) {
      setStatus('won');
      const time = elapsed;
      if (bestTime === null || time < bestTime) {
        api.games
          .updateBest('minesweeper', time)
          .then((res) => setBestTime(res.bests.minesweeper?.value ?? time))
          .catch(() => {});
      }
    } else {
      setStatus('playing');
    }
  };

  const handleFlag = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (status === 'won' || status === 'lost') return;
    const cell = board[r][c];
    if (cell.revealed) return;
    const nextFlagged = !cell.flagged;
    if (nextFlagged && flagCount >= MS_MINES) return;
    setBoard((prev) => {
      const b = cloneMsBoard(prev);
      b[r][c].flagged = nextFlagged;
      return b;
    });
    setFlagCount((n) => (nextFlagged ? n + 1 : Math.max(0, n - 1)));
    if (status === 'idle') setStatus('playing');
  };

  const adjacentColor = (n: number) => {
    const colors = ['', '#4dabf7', '#51cf66', '#ff6b6b', '#748ffc', '#cc5de8', '#20c997', '#fcc419', '#ff922b'];
    return colors[n] ?? '#fff';
  };

  return (
    <div className="game-minesweeper">
      <div className="game-minesweeper__status">
        <span>Mines: {Math.max(0, MS_MINES - flagCount)}</span>
        <span>Time: {elapsed}s</span>
        <span>Best: {bestTime !== null ? `${bestTime}s` : '-'}</span>
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

