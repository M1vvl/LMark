import { createTetrisGame } from './tetris-game.js';

const GAME_KEY = 'dino';
const TETRIS_KEY = 'tetris';

function createDinoGame({ shell, status }) {
  shell.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'dino-game';
  wrapper.innerHTML = '<div class="dino-game-toolbar"><div><strong>小恐龙跳跃</strong><small>躲避障碍，跑得更远</small></div><div class="dino-score" id="dinoScore">00000</div><button class="dino-action" id="dinoRestart" type="button">重新开始</button></div><div class="dino-canvas-wrap"><canvas class="dino-canvas" id="dinoCanvas" width="960" height="360" aria-label="小恐龙跳跃游戏"></canvas><div class="dino-overlay" id="dinoOverlay"><strong id="dinoOverlayTitle">准备开始</strong><span id="dinoOverlayHint">点击开始或按空格</span><button class="dino-overlay-button" id="dinoOverlayButton" type="button">开始游戏</button></div></div><div class="dino-help"><span>使用</span><span class="keycap">↑</span><span class="keycap">W</span><span>跳跃</span><span class="keycap">←</span><span class="keycap">↓</span><span class="keycap">→</span><span>移动</span><span class="keycap wide">空格键</span><span>跳跃</span><span class="keycap">P</span><span>暂停</span></div>';
  shell.append(wrapper);
  const canvas = wrapper.querySelector('#dinoCanvas');
  const context = canvas.getContext('2d');
  const scoreLabel = wrapper.querySelector('#dinoScore');
  const overlay = wrapper.querySelector('#dinoOverlay');
  const overlayTitle = wrapper.querySelector('#dinoOverlayTitle');
  const overlayHint = wrapper.querySelector('#dinoOverlayHint');
  const overlayButton = wrapper.querySelector('#dinoOverlayButton');
  let animation = 0;
  let last = 0;
  let running = false;
  let started = false;
  let gameOver = false;
  let score = 0;
  let speed = 270;
  let spawnTimer = 0;
  let obstacles = [];
  const dino = { x: 84, y: 0, width: 38, height: 46, velocity: 0, grounded: true };
  const ground = 300;
  const colors = () => ({ ink: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e7edf5', muted: getComputedStyle(document.documentElement).getPropertyValue('--text-subtle').trim() || '#8290a4', accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#77a7ff' });
  const resize = () => { const ratio = Math.min(1, (canvas.parentElement.clientWidth - 4) / 960); canvas.style.width = `${Math.max(320, canvas.parentElement.clientWidth - 4)}px`; canvas.style.height = `${Math.round(360 * ratio)}px`; };
  const reset = (startNow = false) => { score = 0; speed = 270; spawnTimer = 0; obstacles = []; dino.y = ground - dino.height; dino.velocity = 0; dino.grounded = true; running = startNow; started = startNow; gameOver = false; overlay.hidden = startNow; overlayTitle.textContent = '准备开始'; overlayHint.textContent = '点击开始或按空格'; overlayButton.textContent = '开始游戏'; status.textContent = startNow ? '进行中' : '等待开始'; scoreLabel.textContent = '00000'; };
  const start = () => reset(true);
  const jump = () => { if (!started || gameOver) { if (gameOver) reset(true); else start(); return; } if (dino.grounded) { dino.velocity = -670; dino.grounded = false; } };
  const collide = (a, b) => a.x < b.x + b.width - 5 && a.x + a.width - 5 > b.x && a.y < b.y + b.height && a.y + a.height > b.y + 4;
  const draw = () => {
    const palette = colors();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = palette.muted; context.globalAlpha = .3; context.fillRect(0, ground, canvas.width, 1); context.globalAlpha = 1;
    context.strokeStyle = palette.muted; context.globalAlpha = .16; context.setLineDash([3, 12]); for (let x = 0; x < canvas.width; x += 15) context.strokeRect(x, ground + 7, 1, 1); context.setLineDash([]); context.globalAlpha = 1;
    context.fillStyle = palette.accent; context.beginPath(); context.roundRect(dino.x, dino.y, dino.width, dino.height, 8); context.fill();
    context.fillStyle = palette.ink; context.fillRect(dino.x + 25, dino.y + 11, 4, 4); context.fillRect(dino.x + 4, dino.y + dino.height - 3, 10, 4); context.fillRect(dino.x + 25, dino.y + dino.height - 3, 10, 4);
    context.fillStyle = palette.ink; obstacles.forEach((obstacle) => { context.beginPath(); context.roundRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 4); context.fill(); context.fillRect(obstacle.x - 5, obstacle.y + 10, 5, 4); });
  };
  const frame = (time) => {
    if (!last) last = time; const delta = Math.min(.035, (time - last) / 1000); last = time;
    if (running && !gameOver) { dino.velocity += 1800 * delta; dino.y += dino.velocity * delta; if (dino.y >= ground - dino.height) { dino.y = ground - dino.height; dino.velocity = 0; dino.grounded = true; } spawnTimer += delta; if (spawnTimer > Math.max(.7, 1.3 - score / 9000)) { spawnTimer = 0; const height = 22 + Math.random() * 25; obstacles.push({ x: canvas.width + 12, y: ground - height, width: 17 + Math.random() * 11, height }); } obstacles.forEach((obstacle) => { obstacle.x -= speed * delta; }); obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -20); if (obstacles.some((obstacle) => collide(dino, obstacle))) { gameOver = true; running = false; overlay.hidden = false; overlayTitle.textContent = 'GAME OVER'; overlayHint.textContent = '点击重来，或按空格重新开始'; overlayButton.textContent = '重来'; status.textContent = '已结束'; } score += delta * speed / 3; speed = Math.min(520, speed + delta * 3); scoreLabel.textContent = String(Math.floor(score)).padStart(5, '0'); }
    draw(); animation = requestAnimationFrame(frame);
  };
  const keyHandler = (event) => { if (!wrapper.isConnected) return; if (event.code === 'Space' || event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') { event.preventDefault(); jump(); } if (event.key.toLowerCase() === 'p' && started && !gameOver) { running = !running; status.textContent = running ? '进行中' : '已暂停'; } };
  document.addEventListener('keydown', keyHandler); wrapper.querySelector('#dinoRestart').addEventListener('click', start); overlayButton.addEventListener('click', start); canvas.addEventListener('pointerdown', jump); window.addEventListener('resize', resize); reset(false); resize(); animation = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(animation); document.removeEventListener('keydown', keyHandler); window.removeEventListener('resize', resize); };
}

export function createLeisureController({ onToast }) {
  const sidebar = document.getElementById('leisureSidebar');
  const gameStage = document.getElementById('leisureStage');
  const globalStage = document.getElementById('globalStage');
  const shell = document.getElementById('leisureGameShell');
  const status = document.getElementById('leisureStatus');
  const contentToolbar = document.querySelector('.content-toolbar');
  const search = document.querySelector('.workspace-search');
  const sections = document.getElementById('workspaceSections');
  const modeButton = document.getElementById('workspaceModeButton');
  if (!sidebar || !gameStage || !shell) return;
  let destroyGame = null;
  let activeGame = GAME_KEY;
  const mountGame = (gameKey) => { destroyGame?.(); activeGame = gameKey; destroyGame = gameKey === TETRIS_KEY ? createTetrisGame({ shell, status }) : createDinoGame({ shell, status }); };
  const apply = (mode) => {
    const leisure = mode === 'leisure';
    const global = mode === 'global';
    // Keep the mode switch visible, but isolate each mode's navigation/content.
    sidebar.hidden = !leisure;
    gameStage.hidden = !leisure;
    search.hidden = leisure || global;
    sections.hidden = leisure || global;
    // The breadcrumb and document actions belong to the work area only. The
    // leisure canvas should start at the top of the right content surface.
    if (contentToolbar) contentToolbar.hidden = leisure || global;
    if (globalStage) globalStage.hidden = !global;
    document.body.dataset.workspaceMode = mode;
    modeButton?.classList.toggle('leisure-mode-button', leisure);
    if (leisure && !destroyGame) mountGame(activeGame);
    if (!leisure && destroyGame) { destroyGame(); destroyGame = null; shell.replaceChildren(); }
  };
  sidebar.querySelectorAll('[data-leisure-game]').forEach((button) => button.addEventListener('click', () => { sidebar.querySelectorAll('.active').forEach((item) => item.classList.remove('active')); button.classList.add('active'); mountGame(button.dataset.leisureGame); }));
  document.addEventListener('workspace:mode-changed', (event) => apply(event.detail?.mode));
  apply(document.body.dataset.workspaceMode || 'work');
}
