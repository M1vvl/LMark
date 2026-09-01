const COLS = 10;
const ROWS = 20;
const SHAPES = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
  [[0, 1, 1], [1, 1, 0]]
];
const PALETTE = ['#56c7df', '#ffd166', '#c084fc', '#76d88c', '#ff8b7b', '#73a7ff', '#f39ac7'];

function rotate(shape) {
  return shape[0].map((_value, column) => shape.map((row) => row[column]).reverse());
}

export function createTetrisGame({ shell, status }) {
  shell.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'tetris-game';
  wrapper.innerHTML = '<div class="tetris-game-toolbar"><div><strong>俄罗斯方块</strong><small>←/→ 移动 · ↑/W 旋转 · ↓/S 加速 · 空格直落 · P 暂停</small></div><div class="tetris-score"><span id="tetrisScore">00000</span><small>分数</small></div><button class="tetris-action" id="tetrisStart" type="button">开始游戏</button><button class="tetris-action" id="tetrisPause" type="button">暂停</button><button class="tetris-action" id="tetrisRestart" type="button">重来</button></div><div class="tetris-board-wrap"><canvas class="tetris-canvas" id="tetrisCanvas" width="300" height="600" aria-label="俄罗斯方块游戏"></canvas><div class="tetris-overlay" id="tetrisOverlay"><strong id="tetrisOverlayTitle">准备开始</strong><span id="tetrisOverlayHint">点击“开始游戏”进入</span></div></div><div class="tetris-help"><span class="keycap">←</span><span class="keycap">→</span>移动 <span class="keycap">↑</span><span class="keycap">W</span>旋转 <span class="keycap">↓</span><span class="keycap">S</span>加速 <span class="keycap wide">空格</span>直落</div>';
  shell.append(wrapper);
  const canvas = wrapper.querySelector('#tetrisCanvas');
  const context = canvas.getContext('2d');
  const overlay = wrapper.querySelector('#tetrisOverlay');
  const overlayTitle = wrapper.querySelector('#tetrisOverlayTitle');
  const overlayHint = wrapper.querySelector('#tetrisOverlayHint');
  const scoreLabel = wrapper.querySelector('#tetrisScore');
  let board = []; let piece = null; let score = 0; let lines = 0; let running = false; let gameOver = false; let animation = 0; let last = 0; let dropElapsed = 0;
  const colors = () => ({ ink: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e7edf5', muted: getComputedStyle(document.documentElement).getPropertyValue('--text-subtle').trim() || '#8290a4', panel: getComputedStyle(document.documentElement).getPropertyValue('--bg-input').trim() || '#171b21' });
  const resize = () => { const available = Math.max(240, wrapper.querySelector('.tetris-board-wrap').clientHeight - 4); const scale = Math.min(1, available / 600, (wrapper.querySelector('.tetris-board-wrap').clientWidth - 4) / 300); canvas.style.width = `${Math.round(300 * scale)}px`; canvas.style.height = `${Math.round(600 * scale)}px`; };
  const newBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const makePiece = () => { const index = Math.floor(Math.random() * SHAPES.length); const shape = SHAPES[index].map((row) => [...row]); return { shape, color: PALETTE[index], x: Math.floor((COLS - shape[0].length) / 2), y: 0 }; };
  const collides = (candidate) => candidate.shape.some((row, y) => row.some((cell, x) => cell && (candidate.x + x < 0 || candidate.x + x >= COLS || candidate.y + y >= ROWS || (candidate.y + y >= 0 && board[candidate.y + y][candidate.x + x]))));
  const merge = () => { piece.shape.forEach((row, y) => row.forEach((cell, x) => { if (cell && piece.y + y >= 0) board[piece.y + y][piece.x + x] = piece.color; })); };
  const clearLines = () => { let cleared = 0; board = board.filter((row) => { const full = row.every(Boolean); if (full) cleared += 1; return !full; }); while (board.length < ROWS) board.unshift(Array(COLS).fill(null)); if (cleared) { lines += cleared; score += [0, 100, 300, 500, 800][cleared] || 800; scoreLabel.textContent = String(score).padStart(5, '0'); } };
  const spawn = () => { piece = makePiece(); if (collides(piece)) { gameOver = true; running = false; overlayTitle.textContent = 'GAME OVER'; overlayHint.textContent = '点击“重来”后重新开始'; overlay.hidden = false; status.textContent = '已结束'; } };
  const drop = () => { const candidate = { ...piece, y: piece.y + 1 }; if (!collides(candidate)) piece.y += 1; else { merge(); clearLines(); spawn(); } };
  const hardDrop = () => { if (!running || gameOver) return; while (!collides({ ...piece, y: piece.y + 1 })) piece.y += 1; drop(); };
  const move = (delta) => { if (!running || gameOver) return; const candidate = { ...piece, x: piece.x + delta }; if (!collides(candidate)) piece.x += delta; };
  const turn = () => { if (!running || gameOver) return; const rotated = rotate(piece.shape); const candidate = { ...piece, shape: rotated }; if (!collides(candidate)) piece.shape = rotated; else { for (const offset of [-1, 1, -2, 2]) { const kicked = { ...candidate, x: piece.x + offset }; if (!collides(kicked)) { piece.shape = rotated; piece.x += offset; break; } } } };
  const start = () => { board = newBoard(); score = 0; lines = 0; scoreLabel.textContent = '00000'; gameOver = false; running = true; dropElapsed = 0; overlay.hidden = true; status.textContent = '进行中'; spawn(); };
  const pause = () => { if (!gameOver && piece) { running = !running; overlayTitle.textContent = running ? '继续游戏' : '已暂停'; overlayHint.textContent = running ? '' : '按 P 继续'; overlay.hidden = running; status.textContent = running ? '进行中' : '已暂停'; } };
  const drawCell = (x, y, color, size) => { context.fillStyle = color; context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2); context.fillStyle = 'rgba(255,255,255,.18)'; context.fillRect(x * size + 2, y * size + 2, size - 4, 2); };
  const draw = () => { const palette = colors(); const size = canvas.width / COLS; context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = palette.panel; context.fillRect(0, 0, canvas.width, canvas.height); context.strokeStyle = 'rgba(255,255,255,.07)'; for (let x = 0; x <= COLS; x += 1) { context.beginPath(); context.moveTo(x * size, 0); context.lineTo(x * size, canvas.height); context.stroke(); } for (let y = 0; y <= ROWS; y += 1) { context.beginPath(); context.moveTo(0, y * size); context.lineTo(canvas.width, y * size); context.stroke(); } board.forEach((row, y) => row.forEach((color, x) => { if (color) drawCell(x, y, color, size); })); if (piece) piece.shape.forEach((row, y) => row.forEach((cell, x) => { if (cell && piece.y + y >= 0) drawCell(piece.x + x, piece.y + y, piece.color, size); })); };
  const frame = (time) => { if (!last) last = time; const delta = Math.min(.05, (time - last) / 1000); last = time; if (running && !gameOver) { dropElapsed += delta; const interval = Math.max(.13, .78 - Math.floor(lines / 5) * .06); if (dropElapsed >= interval) { dropElapsed = 0; drop(); } } draw(); animation = requestAnimationFrame(frame); };
  const keyHandler = (event) => { if (!wrapper.isConnected) return; const key = event.key.toLowerCase(); if (['arrowleft', 'arrowright', 'arrowdown', 'arrowup', 'a', 'd', 's', 'w', 'p'].includes(key) || event.code === 'Space') event.preventDefault(); if (key === 'arrowleft' || key === 'a') move(-1); if (key === 'arrowright' || key === 'd') move(1); if (key === 'arrowdown' || key === 's') drop(); if (key === 'arrowup' || key === 'w') turn(); if (event.code === 'Space') hardDrop(); if (key === 'p') pause(); };
  wrapper.querySelector('#tetrisStart').addEventListener('click', start); wrapper.querySelector('#tetrisPause').addEventListener('click', pause); wrapper.querySelector('#tetrisRestart').addEventListener('click', start); document.addEventListener('keydown', keyHandler); window.addEventListener('resize', resize); board = newBoard(); status.textContent = '等待开始'; resize(); draw(); animation = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(animation); document.removeEventListener('keydown', keyHandler); window.removeEventListener('resize', resize); };
}
