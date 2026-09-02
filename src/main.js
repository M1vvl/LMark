const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, safeStorage, screen, session, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn, spawnSync } = require('node:child_process');
const { normalizeConfiguration, requestCompatibleAi, listCompatibleModels } = require('./main/ai/openai-compatible');
const { exportKnowledgePdf } = require('./main/notes/pdf-export');
const { getCurrentWallpaper, chooseProject: chooseWallpaperProject, resolveWallpaperUrl } = require('./main/wallpaper-engine');
const { migrateUserData, migrateSettings, paths: userDataPaths } = require('./main/storage/user-data');
const { createUpdater } = require('./main/updater');

let mainWindow;
let projectsWatcher;
let projectsWatchTimer;
let aiConfiguration = null;
const aiAbortControllers = new Map();
let aiSidecarWindow;
let aiSidecarMode = { mode: 'api', provider: 'chatgpt' };
let aiSidecarPrefill = '';
let aiSidecarAutoSend = false;
let activeKnowledgeContext = { project: null, filePath: '', dirty: false };
let projectRootPath;
let localSettings = {};
let tray;
let isQuitting = false;
const aiWindows = new Map();
let globalStarMapProcess;
let startupLogPath;
let updater;
const PROJECT_ROOT_SETTING = 'projectRootPath';
const GLOBAL_ROOT_NAME = 'Global';
const STARMAP_URL = 'http://127.0.0.1:5173/';
const WORKSPACE_MARKER = '.codex-workbar.json';
const KNOWLEDGE_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const LEARNING_ASSISTANT_PROMPT = '你是一名严谨的中文学习助手。回答应先给出 2 至 5 条简明的思路摘要，再建立知识框架并解释核心概念、推导逻辑、常见误区与练习路径；思路摘要只说明解题路线和依据，不输出隐藏的逐字思维链。用户要求系统学习某个主题时，输出应当是可直接保存的 Markdown 学习文档：使用清晰标题层级，依次覆盖先修知识、直觉、底层机制、逐步推导、至少两个由浅入深的例子、可运行或可手算的练习、常见误区和自测题；小知识点不能只给结论，要说明原因和适用边界。数学公式必须使用规范的 LaTeX 定界符 $...$ 或 $$...$$，变量、上下标与运算符不可省略。根据用户水平控制术语密度。不要声称已经写入文件，只有软件明确执行保存操作后文件才会产生。';

const BROWSER_PROVIDERS = Object.freeze({
  chatgpt: { title: 'ChatGPT', url: 'https://chatgpt.com/', partition: 'persist:ai-chatgpt' },
  claude: { title: 'Claude', url: 'https://claude.ai/', partition: 'persist:ai-claude' },
  kimi: { title: 'Kimi', url: 'https://www.kimi.com/', partition: 'persist:ai-kimi' },
  deepseek: { title: 'DeepSeek', url: 'https://chat.deepseek.com/', partition: 'persist:ai-deepseek' }
});
// Keep the established settings location so existing private API credentials
// survive the visible product rename to LMark.
app.setPath('userData', userDataPaths(app).current);
app.setPath('cache', path.join(app.getPath('temp'), 'LMarkCache'));
startupLogPath = path.join(app.getPath('userData'), 'startup.log');
// Keep Chromium hardware acceleration enabled on Windows. The renderer uses
// canvas games and animated side panels; forcing software compositing makes
// every translucent menu and pointer transition block the UI thread.

function logStartup(message, error) {
  const detail = error?.stack || error?.message || (error ? String(error) : '');
  const line = `${new Date().toISOString()} [main] ${message}${detail ? `\n${detail}` : ''}\n`;
  try { fs.appendFileSync(startupLogPath, line, 'utf8'); } catch { /* Console logging remains available. */ }
  if (error) console.error(`[main] ${message}`, error);
  else console.log(`[main] ${message}`);
}

function validateFolderName(folderName) {
  const name = typeof folderName === 'string' ? folderName.trim() : '';
  const reservedDeviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (!name || name === '.' || name === '..') throw new Error('项目名称不能为空');
  if (name !== folderName || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)) throw new Error('项目名称包含 Windows 不支持的字符');
  if (reservedDeviceName.test(name)) throw new Error('该名称是 Windows 保留设备名');
  return name;
}

function defaultProjectsRoot() {
  return path.join(app.getPath('userData'), 'Projects');
}

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadLocalSettings() {
  try {
    localSettings = migrateSettings(JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8')) || {});
    if (typeof localSettings?.[PROJECT_ROOT_SETTING] === 'string' && path.isAbsolute(localSettings[PROJECT_ROOT_SETTING])) {
      projectRootPath = path.resolve(localSettings[PROJECT_ROOT_SETTING]);
    }
  } catch { localSettings = {}; }
  if (!projectRootPath) projectRootPath = defaultProjectsRoot();
  restoreAIConfiguration();
}

function restoreAIConfiguration() {
  const saved = localSettings?.aiConfiguration;
  if (!saved?.baseUrl || !saved?.model || !saved?.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return;
  try {
    const apiKey = safeStorage.decryptString(Buffer.from(saved.encryptedApiKey, 'base64'));
    aiConfiguration = normalizeConfiguration({ ...saved, apiKey });
  } catch (error) {
    logStartup('Stored AI configuration could not be restored', error);
    aiConfiguration = null;
  }
}

async function persistAIConfiguration(configuration) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前 Windows 用户环境不支持安全密钥存储');
  const encryptedApiKey = safeStorage.encryptString(configuration.apiKey).toString('base64');
  localSettings = {
    ...localSettings,
    aiConfiguration: {
      provider: configuration.provider,
      protocol: configuration.protocol,
      baseUrl: configuration.baseUrl,
      model: configuration.model,
      reasoning: configuration.reasoning,
      encryptedApiKey
    }
  };
  await saveLocalSettings();
}

async function saveLocalSettings() {
  const settingsPath = settingsFilePath();
  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  localSettings = migrateSettings({ ...localSettings, [PROJECT_ROOT_SETTING]: projectRootPath });
  const temporaryPath = `${settingsPath}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify(localSettings, null, 2), 'utf8');
  try { await fs.promises.rename(temporaryPath, settingsPath); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.promises.rm(settingsPath, { force: true });
    await fs.promises.rename(temporaryPath, settingsPath);
  }
}

function managedProjectsRoot() {
  return projectRootPath || defaultProjectsRoot();
}

async function ensureManagedProjectsRoot() {
  const root = managedProjectsRoot();
  await fs.promises.mkdir(root, { recursive: true });
  return root;
}

function globalRootPath() { return path.join(app.getPath('userData'), GLOBAL_ROOT_NAME); }
async function ensureGlobalRoot() { const root = globalRootPath(); await fs.promises.mkdir(root, { recursive: true }); return root; }

function starMapRoots() {
  return [
    path.join(app.getAppPath(), GLOBAL_ROOT_NAME, 'StarMap', '01_Web'),
    path.join(process.cwd(), GLOBAL_ROOT_NAME, 'StarMap', '01_Web'),
    path.join(app.getPath('userData'), GLOBAL_ROOT_NAME, 'StarMap', '01_Web'),
    path.join(process.resourcesPath, GLOBAL_ROOT_NAME, 'StarMap', '01_Web')
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function findStarMapRoot() {
  return starMapRoots().find((root) => fs.existsSync(path.join(root, 'package.json')));
}

async function isStarMapAvailable() {
  try {
    const response = await fetch(STARMAP_URL, { signal: AbortSignal.timeout(1200) });
    response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

async function startGlobalStarMap() {
  if (await isStarMapAvailable()) return { ok: true, url: STARMAP_URL, started: false };
  const root = findStarMapRoot();
  if (!root) throw new Error('没有找到环球区\\StarMap\\01_Web，请先把 StarMap 放入环球区文件夹');
  if (!globalStarMapProcess || globalStarMapProcess.exitCode !== null) {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    globalStarMapProcess = spawn(npmCommand, ['run', 'dev:public'], {
      cwd: root,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    globalStarMapProcess.stdout?.on('data', (chunk) => logStartup(`StarMap: ${String(chunk).trim()}`));
    globalStarMapProcess.stderr?.on('data', (chunk) => logStartup(`StarMap: ${String(chunk).trim()}`));
    globalStarMapProcess.once('error', (error) => logStartup('StarMap process failed', error));
    globalStarMapProcess.once('exit', () => { globalStarMapProcess = undefined; });
  }
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await isStarMapAvailable()) return { ok: true, url: STARMAP_URL, started: true };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('StarMap 启动超时，请检查 Node.js 和依赖是否已安装');
}

async function listManagedProjects() {
  const root = await ensureManagedProjectsRoot();
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(root, entry.name);
    try { await fs.promises.access(path.join(folderPath, WORKSPACE_MARKER)); continue; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    projects.push({ name: entry.name, path: folderPath, managed: true });
  }
  return projects.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { sensitivity: 'base', numeric: true }));
}

async function readWorkspaceMarker(folderPath) {
  try {
    const marker = JSON.parse(await fs.promises.readFile(path.join(folderPath, WORKSPACE_MARKER), 'utf8'));
    if (typeof marker?.id !== 'string' || typeof marker?.name !== 'string') return null;
    return marker;
  } catch { return null; }
}

async function listManagedWorkspaces() {
  const root = await ensureManagedProjectsRoot();
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const workspaces = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(root, entry.name);
    const marker = await readWorkspaceMarker(folderPath);
    if (!marker) continue;
    const children = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const projects = children
      .filter((child) => child.isDirectory())
      .map((child) => ({ name: child.name, path: path.join(folderPath, child.name), managed: true }));
    workspaces.push({ id: marker.id, name: marker.name, path: folderPath, projects });
  }
  return workspaces.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { sensitivity: 'base', numeric: true }));
}

async function broadcastManagedProjects() {
  try {
    const [projects, workspaces] = await Promise.all([listManagedProjects(), listManagedWorkspaces()]);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('projects:changed', projects);
      mainWindow.webContents.send('workspaces:changed', workspaces);
    }
  } catch (error) {
    logStartup('Failed to scan managed projects', error);
  }
}

async function startProjectsWatcher() {
  const root = await ensureManagedProjectsRoot();
  projectsWatcher?.close();
  projectsWatcher = fs.watch(root, { recursive: process.platform === 'win32' }, () => {
    clearTimeout(projectsWatchTimer);
    projectsWatchTimer = setTimeout(broadcastManagedProjects, 180);
  });
  projectsWatcher.on('error', (error) => logStartup('Managed projects watcher failed', error));
}

async function createManagedWorkspace({ id, name }) {
  const safeName = validateFolderName(name);
  if (typeof id !== 'string' || !/^workspace-[a-z0-9-]+$/i.test(id)) throw new Error('工作栏标识无效');
  const root = await ensureManagedProjectsRoot();
  const folderPath = path.join(root, safeName);
  try { await fs.promises.access(folderPath); throw new Error('默认位置中已经存在同名文件夹'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.promises.mkdir(folderPath);
  await fs.promises.writeFile(path.join(folderPath, WORKSPACE_MARKER), JSON.stringify({ id, name: safeName, version: 1 }, null, 2), 'utf8');
  setTimeout(broadcastManagedProjects, 80);
  return { id, name: safeName, path: folderPath, projects: [] };
}

async function ensureManagedWorkspace({ id, name, folderPath }) {
  const safeName = validateFolderName(name);
  const root = path.resolve(await ensureManagedProjectsRoot());
  const targetPath = folderPath ? path.resolve(folderPath) : path.join(root, safeName);
  if (path.dirname(targetPath).toLowerCase() !== root.toLowerCase()) throw new Error('工作栏文件夹必须位于默认项目保存位置内');
  await fs.promises.mkdir(targetPath, { recursive: true });
  const markerPath = path.join(targetPath, WORKSPACE_MARKER);
  const existing = await readWorkspaceMarker(targetPath);
  if (existing && existing.id !== id) throw new Error('该文件夹已经属于另一个工作栏');
  await fs.promises.writeFile(markerPath, JSON.stringify({ id, name: safeName, version: 1 }, null, 2), 'utf8');
  return { id, name: safeName, path: targetPath };
}

async function resolveManagedProjectParent(folderPath) {
  const root = path.resolve(await ensureManagedProjectsRoot());
  if (!folderPath) return root;
  const parent = path.resolve(folderPath);
  if (parent.toLowerCase() === root.toLowerCase()) return root;
  if (path.dirname(parent).toLowerCase() !== root.toLowerCase() || !(await readWorkspaceMarker(parent))) {
    throw new Error('项目父文件夹不是有效的工作栏目录');
  }
  return parent;
}

async function setManagedProjectsRoot(nextPath) {
  if (typeof nextPath !== 'string' || !path.isAbsolute(nextPath)) throw new Error('保存位置必须是绝对路径');
  const resolvedPath = path.resolve(nextPath);
  const diskRoot = path.parse(resolvedPath).root;
  if (resolvedPath.toLowerCase() === diskRoot.toLowerCase()) throw new Error('不能把磁盘根目录作为项目保存位置');
  projectRootPath = resolvedPath;
  await ensureManagedProjectsRoot();
  await saveLocalSettings();
  await startProjectsWatcher();
  await broadcastManagedProjects();
  return projectRootPath;
}

function resolveSafeProjectPath(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath.trim()) throw new Error('项目没有关联本地目录');
  const resolvedPath = path.resolve(folderPath);
  const diskRoot = path.parse(resolvedPath).root;
  if (resolvedPath.toLowerCase() === diskRoot.toLowerCase()) throw new Error('不允许操作磁盘根目录');
  if (resolvedPath.toLowerCase() === path.resolve(managedProjectsRoot()).toLowerCase()) throw new Error('不允许删除项目根目录');
  return resolvedPath;
}

function resolveProjectFile(projectPath, relativePath) {
  const root = resolveSafeProjectPath(projectPath);
  const target = path.resolve(root, relativePath || '');
  if (target !== root && !target.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw new Error('文件路径超出项目目录');
  return { root, target };
}

async function resolveManagedProjectPath(folderPath) {
  const resolvedPath = resolveSafeProjectPath(folderPath);
  const root = path.resolve(await ensureManagedProjectsRoot());
  const parent = path.dirname(resolvedPath);
  const directProject = parent.toLowerCase() === root.toLowerCase() && !(await readWorkspaceMarker(resolvedPath));
  const workspaceProject = path.dirname(parent).toLowerCase() === root.toLowerCase() && Boolean(await readWorkspaceMarker(parent));
  if (!directProject && !workspaceProject) throw new Error('项目不在当前默认保存位置内');
  const stats = await fs.promises.stat(resolvedPath);
  if (!stats.isDirectory()) throw new Error('项目路径不是文件夹');
  return resolvedPath;
}

async function resolveKnowledgeFile(projectPath, relativePath, allowedExtensions = KNOWLEDGE_EXTENSIONS) {
  const root = await resolveManagedProjectPath(projectPath);
  const { target } = resolveProjectFile(root, relativePath);
  if (target === root || !allowedExtensions.has(path.extname(target).toLowerCase())) throw new Error('不支持的知识文件类型');
  return { root, target };
}

async function listKnowledgeFiles(projectPath) {
  const root = await resolveManagedProjectPath(projectPath);
  const files = [];
  async function walk(folderPath, depth) {
    if (depth > 4 || files.length >= 200) return;
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= 200 || entry.name.startsWith('.')) continue;
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      else if (entry.isFile() && KNOWLEDGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stats = await fs.promises.stat(fullPath);
        files.push({ name: entry.name, path: path.relative(root, fullPath), size: stats.size, modifiedAt: stats.mtimeMs });
      }
    }
  }
  await walk(root, 0);
  return files.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

async function writeKnowledgeFile(projectPath, fileName, content) {
  const root = await resolveManagedProjectPath(projectPath);
  const safeBase = validateFolderName(fileName || '学习笔记').replace(/\.(md|markdown|txt)$/i, '');
  if (typeof content !== 'string' || !content.trim() || content.length > 1_000_000) throw new Error('知识内容为空或过长');
  let targetPath;
  for (let index = 0; index < 100; index += 1) {
    const suffix = index ? `-${index + 1}` : '';
    targetPath = path.join(root, `${safeBase}${suffix}.md`);
    try {
      await fs.promises.writeFile(targetPath, content.trim(), { encoding: 'utf8', flag: 'wx' });
      return { name: path.basename(targetPath), path: path.relative(root, targetPath) };
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('同名知识文件过多，请更换名称');
}

function yamlQuote(value) { return JSON.stringify(String(value ?? '')); }

function standardKnowledgeDocument(title, body = '') {
  const now = new Date().toISOString();
  const cleanBody = String(body).replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '').trim();
  return `---\ntitle: ${yamlQuote(title)}\ncreated: ${yamlQuote(now)}\nupdated: ${yamlQuote(now)}\nannotations:\n---\n\n${cleanBody || `# ${title}`}\n`;
}

async function createKnowledgeFile(projectPath, fileName) {
  const name = validateFolderName(fileName || '新建知识').replace(/\.(md|markdown|txt)$/i, '');
  return writeKnowledgeFile(projectPath, name, standardKnowledgeDocument(name));
}

async function saveKnowledgeFile(projectPath, relativePath, content) {
  const { root, target } = await resolveKnowledgeFile(projectPath, relativePath);
  if (typeof content !== 'string' || content.length > 5_000_000) throw new Error('知识内容超过 5 MB 限制');
  const handle = await fs.promises.open(target, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  const stats = await fs.promises.stat(target);
  return { name: path.basename(target), path: path.relative(root, target), modifiedAt: stats.mtimeMs };
}

function knowledgeDocumentContent(fileName, content) {
  const body = typeof content === 'string' ? content.trim() : '';
  if (!body) throw new Error('AI 回答为空，无法写入知识文件');
  if (body.length > 1_000_000) throw new Error('AI 回答超过 1 MB，请拆分后写入');
  const title = validateFolderName(fileName || 'AI 学习笔记').replace(/\.(md|markdown|txt)$/i, '');
  return standardKnowledgeDocument(title, /^#\s+\S/m.test(body) ? body : `# ${title}\n\n${body}`);
}

async function saveAiKnowledgeDocument(request) {
  const projectPath = request?.projectPath;
  const relativePath = typeof request?.relativePath === 'string' ? request.relativePath.trim() : '';
  const mode = request?.mode === 'overwrite' ? 'overwrite' : 'append';
  const targetsDirtyDocument = Boolean(relativePath
    && activeKnowledgeContext.dirty
    && activeKnowledgeContext.project?.path?.toLowerCase() === path.resolve(projectPath).toLowerCase()
    && activeKnowledgeContext.filePath.toLowerCase() === relativePath.toLowerCase());
  if (targetsDirtyDocument) throw new Error('目标知识文件在主窗口中有未保存修改，请等待自动保存后重试');
  let file;
  if (!relativePath) {
    const fileName = request?.fileName || 'AI 学习笔记';
    file = await writeKnowledgeFile(projectPath, fileName, knowledgeDocumentContent(fileName, request?.content));
  } else {
    const { target } = await resolveKnowledgeFile(projectPath, relativePath);
    const stats = await fs.promises.stat(target);
    if (!stats.isFile() || stats.size > 4_000_000) throw new Error('目标知识文件不可写入或内容过大');
    const current = await fs.promises.readFile(target, 'utf8');
    const generated = knowledgeDocumentContent(path.basename(relativePath), request?.content);
    const generatedBody = generated.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
    const appended = current.trim() ? generatedBody.replace(/^#\s+/m, '## ') : generated;
    const content = mode === 'overwrite'
      ? generated
      : `${current.trimEnd()}${current.trim() ? '\n\n---\n\n' : ''}${appended}`;
    file = await saveKnowledgeFile(projectPath, relativePath, content);
  }
  const project = { name: path.basename(path.resolve(projectPath)), path: path.resolve(projectPath) };
  const update = { project, file, mode: relativePath ? mode : 'create' };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('knowledge:ai-saved', update);
  return update;
}

async function renameKnowledgeFile(projectPath, relativePath, nextName) {
  const { root, target } = await resolveKnowledgeFile(projectPath, relativePath);
  const currentExtension = path.extname(target).toLowerCase();
  const requested = validateFolderName(nextName);
  const requestedExtension = path.extname(requested).toLowerCase();
  const finalName = KNOWLEDGE_EXTENSIONS.has(requestedExtension) ? requested : `${requested}${currentExtension}`;
  const destination = path.join(path.dirname(target), finalName);
  resolveProjectFile(root, path.relative(root, destination));
  if (destination.toLowerCase() !== target.toLowerCase()) {
    try { await fs.promises.access(destination); throw new Error('同一位置已经存在同名知识文件'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.promises.rename(target, destination);
  }
  return { name: path.basename(destination), path: path.relative(root, destination) };
}

async function saveKnowledgeImage(projectPath, image) {
  const root = await resolveManagedProjectPath(projectPath);
  const inputName = validateFolderName(image?.name || 'image.png');
  const extension = path.extname(inputName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('仅支持 PNG、JPG、WEBP 或 GIF 图片');
  const bytes = Buffer.from(image?.bytes || []);
  if (!bytes.length || bytes.length > 12_000_000) throw new Error('图片为空或超过 12 MB');
  const assetFolder = path.join(root, 'assets');
  await fs.promises.mkdir(assetFolder, { recursive: true });
  const baseName = path.basename(inputName, extension).replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
  let target;
  for (let index = 0; index < 100; index += 1) {
    const suffix = index ? `-${index + 1}` : '';
    target = path.join(assetFolder, `${baseName}${suffix}${extension}`);
    try { await fs.promises.writeFile(target, bytes, { flag: 'wx' }); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; target = null; }
  }
  if (!target) throw new Error('同名图片过多，请更换文件名');
  const relativePath = path.relative(root, target).replaceAll('\\', '/');
  return { name: path.basename(target), path: relativePath };
}

async function knowledgeImageData(projectPath, relativePath) {
  const { target } = await resolveKnowledgeFile(projectPath, relativePath, IMAGE_EXTENSIONS);
  const stats = await fs.promises.stat(target);
  if (!stats.isFile() || stats.size > 12_000_000) throw new Error('图片不存在或超过 12 MB');
  const extension = path.extname(target).toLowerCase();
  const mime = extension === '.png' ? 'image/png' : extension === '.gif' ? 'image/gif' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${(await fs.promises.readFile(target)).toString('base64')}`;
}

async function readKnowledgeNotes(projectPath, relativePath) {
  const { target } = await resolveKnowledgeFile(projectPath, relativePath);
  const content = await fs.promises.readFile(target, 'utf8');
  const match = content.match(/^---\s*\r?\n[\s\S]*?^documentNote:\s*(.+)$/m);
  if (!match) return '';
  try { return JSON.parse(match[1].trim()); } catch { return match[1].trim(); }
}

async function saveKnowledgeNotes(projectPath, relativePath, content) {
  const { target } = await resolveKnowledgeFile(projectPath, relativePath);
  if (typeof content !== 'string' || content.length > 100_000) throw new Error('备注超过 100 KB 限制');
  let markdown = await fs.promises.readFile(target, 'utf8');
  if (!/^---\s*\r?\n/.test(markdown)) markdown = standardKnowledgeDocument(path.basename(relativePath, path.extname(relativePath)), markdown);
  const boundary = markdown.indexOf('\n---', 4);
  const head = markdown.slice(0, boundary);
  const body = markdown.slice(boundary);
  const nextHead = /^documentNote:/m.test(head)
    ? head.replace(/^documentNote:.*$/m, `documentNote: ${yamlQuote(content.trim())}`)
    : `${head}\ndocumentNote: ${yamlQuote(content.trim())}`;
  await saveKnowledgeFile(projectPath, relativePath, `${nextHead}${body}`);
}

async function chooseDocumentForAnalysis() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: '论文与文档', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'csv'] }] });
  if (result.canceled) return { ok: true, canceled: true };
  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).toLowerCase();
  let content = '';
  content = await fs.promises.readFile(filePath, 'utf8');
  if (extension === '.html' || extension === '.htm') content = content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
  if (!content.trim()) throw new Error('文档没有可提取的文本');
  return { ok: true, path: filePath, name: path.basename(filePath), extension, content: content.slice(0, 20_000) };
}

async function requestAi(messages, signal) {
  if (!aiConfiguration) throw new Error('请先配置 API');
  return requestCompatibleAi(net.fetch, aiConfiguration, messages, { systemPrompt: LEARNING_ASSISTANT_PROMPT, signal });
}

function openBrowserAi(providerId) {
  const provider = BROWSER_PROVIDERS[providerId];
  if (!provider) throw new Error('不支持的浏览器 AI 服务');
  const existing = aiWindows.get(providerId);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
  const providerSession = session.fromPartition(provider.partition);
  providerSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const browserWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    title: `${provider.title} - LMark`,
    icon: path.join(__dirname, 'renderer', 'assets', 'lmark-logo.png'),
    backgroundColor: '#111316',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, partition: provider.partition }
  });
  browserWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, partition: provider.partition } }
  }));
  browserWindow.loadURL(provider.url).catch((error) => logStartup(`Failed to open ${provider.title}`, error));
  browserWindow.on('closed', () => aiWindows.delete(providerId));
  aiWindows.set(providerId, browserWindow);
}

function sidecarWidth() {
  return Math.min(760, Math.max(360, Number(localSettings.aiSidecarWidth) || 500));
}

function notifySidecarVisibility(visible) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:sidecar-visibility', visible);
}

function syncAiSidecarBounds({ makeRoom = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || !aiSidecarWindow || aiSidecarWindow.isDestroyed()) return;
  let bounds = mainWindow.getBounds();
  const width = sidecarWidth();
  const area = screen.getDisplayMatching(bounds).workArea;
  if (makeRoom && bounds.width + width <= area.width && bounds.x + bounds.width + width > area.x + area.width) {
    mainWindow.setPosition(area.x + area.width - bounds.width - width, Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height));
    bounds = mainWindow.getBounds();
  }
  const x = Math.min(bounds.x + bounds.width, area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
  aiSidecarWindow.setBounds({ x, y, width, height: Math.min(bounds.height, area.height) }, false);
}

function createAiSidecarWindow() {
  if (aiSidecarWindow && !aiSidecarWindow.isDestroyed()) return aiSidecarWindow;
  aiSidecarWindow = new BrowserWindow({
    width: sidecarWidth(),
    height: mainWindow?.getBounds().height || 820,
    minWidth: 360,
    minHeight: 520,
    maxWidth: 760,
    frame: false,
    show: false,
    resizable: true,
    skipTaskbar: true,
    parent: mainWindow || undefined,
    backgroundColor: '#15171b',
    icon: path.join(__dirname, 'renderer', 'assets', 'lmark-logo.png'),
    webPreferences: { contextIsolation: true, sandbox: false, webviewTag: true, preload: path.join(__dirname, 'preload.js') }
  });
  aiSidecarWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const allowedOrigins = new Set(Object.values(BROWSER_PROVIDERS).map((provider) => new URL(provider.url).origin));
    let allowed = false;
    try { allowed = allowedOrigins.has(new URL(params.src).origin); } catch { allowed = false; }
    if (!allowed) { event.preventDefault(); return; }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = false;
  });
  aiSidecarWindow.loadFile(path.join(__dirname, 'renderer', 'ai-sidecar.html')).catch((error) => logStartup('Failed to load AI sidecar', error));
  aiSidecarWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) logStartup(`AI sidecar renderer: ${message} (${sourceId}:${line})`);
  });
  aiSidecarWindow.once('ready-to-show', () => {
    syncAiSidecarBounds({ makeRoom: true });
    aiSidecarWindow?.webContents.send('ai:sidecar-set-mode', { ...aiSidecarMode, prefill: aiSidecarPrefill, autoSend: aiSidecarAutoSend });
    aiSidecarPrefill = '';
    aiSidecarAutoSend = false;
    aiSidecarWindow?.show();
    notifySidecarVisibility(true);
  });
  aiSidecarWindow.on('resize', () => {
    if (!aiSidecarWindow || aiSidecarWindow.isDestroyed()) return;
    localSettings.aiSidecarWidth = aiSidecarWindow.getBounds().width;
    saveLocalSettings().catch((error) => logStartup('Failed to save AI sidecar width', error));
  });
  aiSidecarWindow.on('closed', () => { aiSidecarWindow = null; notifySidecarVisibility(false); });
  return aiSidecarWindow;
}

function openAiSidecar(mode = 'api', provider = 'chatgpt', prefill = '', autoSend = false) {
  aiSidecarMode = { mode: mode === 'browser' ? 'browser' : 'api', provider: BROWSER_PROVIDERS[provider] ? provider : 'chatgpt' };
  aiSidecarPrefill = typeof prefill === 'string' ? prefill.slice(0, 20_000) : '';
  aiSidecarAutoSend = Boolean(autoSend && aiSidecarPrefill && aiSidecarMode.mode === 'api');
  const window = createAiSidecarWindow();
  syncAiSidecarBounds({ makeRoom: true });
  if (!window.webContents.isLoadingMainFrame()) {
    window.webContents.send('ai:sidecar-set-mode', { ...aiSidecarMode, prefill: aiSidecarPrefill, autoSend: aiSidecarAutoSend });
    aiSidecarPrefill = '';
    aiSidecarAutoSend = false;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  notifySidecarVisibility(true);
}

function createTrayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'lmark-logo.png')).resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function ensureTray() {
  if (tray) return tray;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('LMark');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 LMark', click: showMainWindow },
    { type: 'separator' },
    { label: '完全退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showMainWindow);
  return tray;
}

function requestWindowClose() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:confirm-close');
}

function createWindow() {
  logStartup('Creating main window');
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'LMark',
    icon: path.join(__dirname, 'renderer', 'assets', 'lmark-logo.png'),
    backgroundColor: '#111316',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: false, webviewTag: true, preload: path.join(__dirname, 'preload.js') }
  });
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const allowedOrigins = new Set(Object.values(BROWSER_PROVIDERS).map((provider) => new URL(provider.url).origin));
    let allowed = false;
    try { allowed = allowedOrigins.has(new URL(params.src).origin); } catch { allowed = false; }
    if (!allowed) { event.preventDefault(); return; }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = false;
  });
  const showWindow = () => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); };
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((error) => logStartup('Failed to load renderer', error));
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) logStartup(`Renderer: ${message} (${sourceId}:${line})`);
  });
  mainWindow.once('ready-to-show', () => { logStartup('Main window ready'); showWindow(); });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => { logStartup(`Renderer load failed (${code}): ${description}`); showWindow(); });
  mainWindow.webContents.on('render-process-gone', (_event, details) => logStartup(`Renderer stopped: ${details.reason}`));
  mainWindow.on('move', () => syncAiSidecarBounds());
  mainWindow.on('resize', () => syncAiSidecarBounds());
  mainWindow.on('minimize', () => aiSidecarWindow?.hide());
  mainWindow.on('restore', () => { if (aiSidecarWindow && !aiSidecarWindow.isDestroyed()) { syncAiSidecarBounds(); aiSidecarWindow.show(); } });
  mainWindow.on('hide', () => aiSidecarWindow?.hide());
  mainWindow.on('show', () => { if (aiSidecarWindow && !aiSidecarWindow.isDestroyed()) { syncAiSidecarBounds(); aiSidecarWindow.show(); } });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    requestWindowClose();
  });
  mainWindow.on('closed', () => { aiSidecarWindow?.destroy(); aiSidecarWindow = null; mainWindow = null; });
  setTimeout(showWindow, 1500);
}

function registerIpcHandlers() {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:close', () => requestWindowClose());
  ipcMain.handle('window:close-choice', (_event, choice) => {
    if (choice === 'hide') {
      ensureTray();
      mainWindow?.hide();
      return { ok: true, hidden: true };
    }
    if (choice === 'quit') {
      isQuitting = true;
      app.quit();
      return { ok: true, quitting: true };
    }
    return { ok: false, error: '未知的关闭方式' };
  });
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'All files', extensions: ['*'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file:preview-pdf', async (_event, filePath) => {
    try {
      if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('PDF 路径无效');
      const resolvedPath = path.resolve(filePath);
      if (path.extname(resolvedPath).toLowerCase() !== '.pdf') throw new Error('当前仅支持预览 PDF 文档');
      const stats = await fs.promises.stat(resolvedPath);
      if (!stats.isFile() || stats.size > 100_000_000) throw new Error('PDF 不存在或超过 100 MB');
      return { ok: true, path: resolvedPath, name: path.basename(resolvedPath), url: pathToFileURL(resolvedPath).href };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('settings:get-project-root', async () => {
    await ensureManagedProjectsRoot();
    return { ok: true, path: managedProjectsRoot(), isDefault: path.resolve(managedProjectsRoot()).toLowerCase() === path.resolve(defaultProjectsRoot()).toLowerCase() };
  });
  ipcMain.handle('settings:set-project-root', async (_event, nextPath) => {
    try { return { ok: true, path: await setManagedProjectsRoot(nextPath) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('global:open-folder', async () => {
    try { const root = await ensureGlobalRoot(); await shell.openPath(root); return { ok: true, path: root }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('global:starmap-status', async () => ({ ok: true, available: await isStarMapAvailable(), url: STARMAP_URL }));
  ipcMain.handle('global:start-starmap', async () => {
    try { return await startGlobalStarMap(); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('update:get-status', () => updater?.getStatus() || { configured: false, packaged: app.isPackaged, version: app.getVersion(), autoUpdate: Boolean(localSettings.autoUpdate) });
  ipcMain.handle('update:set-auto', async (_event, enabled) => {
    localSettings.autoUpdate = Boolean(enabled);
    await saveLocalSettings();
    updater?.setAutoUpdate(localSettings.autoUpdate);
    return updater?.getStatus() || { configured: false, autoUpdate: localSettings.autoUpdate };
  });
  ipcMain.handle('update:check', () => updater?.check({ manual: true }) || { ok: false, error: '更新器未初始化' });
  ipcMain.handle('update:download', () => updater?.download() || { ok: false, error: '更新器未初始化' });
  ipcMain.handle('update:install', () => updater?.install() || { ok: false, error: '更新器未初始化' });
  ipcMain.handle('mcp:get-command', async () => {
    const root = await ensureManagedProjectsRoot();
    const script = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'mcp-server.js')
      : path.join(app.getAppPath(), 'src', 'main', 'mcp-server.js');
    return { ok: true, command: `node "${script}" --root "${root}"`, root, script };
  });
  ipcMain.handle('projects:list-managed', async () => ({ ok: true, root: await ensureManagedProjectsRoot(), projects: await listManagedProjects() }));
  ipcMain.handle('workspaces:list-managed', async () => ({ ok: true, workspaces: await listManagedWorkspaces() }));
  ipcMain.handle('workspaces:create', async (_event, workspace) => {
    try { return { ok: true, workspace: await createManagedWorkspace(workspace || {}) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('workspaces:ensure', async (_event, workspace) => {
    try { return { ok: true, workspace: await ensureManagedWorkspace(workspace || {}) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('workspaces:open-folder', async (_event, folderPath) => {
    try {
      const root = path.resolve(await ensureManagedProjectsRoot());
      const resolvedPath = path.resolve(folderPath || '');
      const isRoot = resolvedPath.toLowerCase() === root.toLowerCase();
      const isWorkspace = path.dirname(resolvedPath).toLowerCase() === root.toLowerCase() && Boolean(await readWorkspaceMarker(resolvedPath));
      if (!isRoot && !isWorkspace) throw new Error('不是有效的工作栏文件夹');
      const openError = await shell.openPath(resolvedPath);
      if (openError) throw new Error(openError);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('workspaces:trash', async (_event, folderPath) => {
    try {
      const root = path.resolve(await ensureManagedProjectsRoot());
      const resolvedPath = path.resolve(folderPath || '');
      if (path.dirname(resolvedPath).toLowerCase() !== root.toLowerCase()) throw new Error('工作栏文件夹不在默认项目保存位置内');
      if (!(await readWorkspaceMarker(resolvedPath))) throw new Error('该目录不是有效的工作栏文件夹');
      await shell.trashItem(resolvedPath);
      await broadcastManagedProjects();
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('projects:create-managed', async (_event, request) => {
    try {
      const name = validateFolderName(typeof request === 'string' ? request : request?.name);
      const parent = await resolveManagedProjectParent(typeof request === 'string' ? null : request?.workspacePath);
      const folderPath = path.join(parent, name);
      try { await fs.promises.access(folderPath); throw new Error('已经存在同名项目文件夹'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.promises.mkdir(folderPath);
      setTimeout(broadcastManagedProjects, 80);
      return { ok: true, project: { name, path: folderPath, managed: true } };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:open-in-explorer', async (_event, folderPath) => {
    try {
      const resolvedPath = await resolveManagedProjectPath(folderPath);
      const openError = await shell.openPath(resolvedPath);
      if (openError) throw new Error(openError);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:list-knowledge', async (_event, folderPath) => {
    try { return { ok: true, files: await listKnowledgeFiles(folderPath) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:read-knowledge', async (_event, folderPath, relativePath) => {
    try {
      const { target } = await resolveKnowledgeFile(folderPath, relativePath);
      const stats = await fs.promises.stat(target);
      if (!stats.isFile() || stats.size > 2_000_000) throw new Error('文件不是可读取的文本，或文件超过 2 MB');
      return { ok: true, content: await fs.promises.readFile(target, 'utf8') };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:write-knowledge', async (_event, folderPath, fileName, content) => {
    try { return { ok: true, file: await writeKnowledgeFile(folderPath, fileName, content) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:create-knowledge', async (_event, folderPath, fileName) => {
    try { return { ok: true, file: await createKnowledgeFile(folderPath, fileName) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:save-knowledge', async (_event, folderPath, relativePath, content) => {
    try { return { ok: true, file: await saveKnowledgeFile(folderPath, relativePath, content) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('knowledge:set-context', (_event, context) => {
    const project = context?.project?.path
      ? { name: String(context.project.name || path.basename(context.project.path)), path: path.resolve(context.project.path) }
      : null;
    activeKnowledgeContext = { project, filePath: typeof context?.filePath === 'string' ? context.filePath : '', dirty: Boolean(context?.dirty) };
    return { ok: true };
  });
  ipcMain.handle('knowledge:get-context', () => activeKnowledgeContext);
  ipcMain.handle('ai:save-knowledge', async (_event, request) => {
    try { return { ok: true, ...(await saveAiKnowledgeDocument(request)) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:rename-knowledge', async (_event, folderPath, relativePath, nextName) => {
    try { return { ok: true, file: await renameKnowledgeFile(folderPath, relativePath, nextName) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:reveal-knowledge', async (_event, folderPath, relativePath) => {
    try {
      const { target } = await resolveKnowledgeFile(folderPath, relativePath);
      await fs.promises.access(target);
      shell.showItemInFolder(target);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:trash-knowledge', async (_event, folderPath, relativePath) => {
    try {
      const { target } = await resolveKnowledgeFile(folderPath, relativePath);
      await shell.trashItem(target);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:save-knowledge-image', async (_event, folderPath, image) => {
    try { return { ok: true, image: await saveKnowledgeImage(folderPath, image) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:choose-knowledge-image', async (_event, folderPath) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (result.canceled) return { ok: true, canceled: true };
      const selected = result.filePaths[0];
      return { ok: true, image: await saveKnowledgeImage(folderPath, { name: path.basename(selected), bytes: await fs.promises.readFile(selected) }) };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:read-knowledge-image', async (_event, folderPath, relativePath) => {
    try { return { ok: true, dataUrl: await knowledgeImageData(folderPath, relativePath) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:read-knowledge-notes', async (_event, folderPath, relativePath) => {
    try { return { ok: true, content: await readKnowledgeNotes(folderPath, relativePath) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:save-knowledge-notes', async (_event, folderPath, relativePath, content) => {
    try { await saveKnowledgeNotes(folderPath, relativePath, content); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:export-knowledge-pdf', async (_event, folderPath, relativePath) => {
    try {
      const { root, target } = await resolveKnowledgeFile(folderPath, relativePath);
      const content = await fs.promises.readFile(target, 'utf8');
      const result = await exportKnowledgePdf({ ownerWindow: mainWindow, root, sourcePath: target, content, title: path.basename(target, path.extname(target)) });
      return { ok: true, ...result };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:rename', async (_event, folderPath, nextName) => {
    try {
      const safeName = validateFolderName(nextName);
      const resolvedPath = await resolveManagedProjectPath(folderPath);
      const targetPath = path.join(path.dirname(resolvedPath), safeName);
      if (targetPath.toLowerCase() !== resolvedPath.toLowerCase()) {
        try { await fs.promises.access(targetPath); throw new Error('同一位置已经存在同名文件夹'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await fs.promises.rename(resolvedPath, targetPath);
      }
      setTimeout(broadcastManagedProjects, 80);
      return { ok: true, path: targetPath, name: safeName };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('project:trash', async (_event, folderPath) => {
    try {
      const resolvedPath = await resolveManagedProjectPath(folderPath);
      let stats;
      try { stats = await fs.promises.stat(resolvedPath); }
      catch (error) {
        if (error?.code === 'ENOENT') return { ok: true, missing: true };
        throw error;
      }
      if (!stats.isDirectory()) throw new Error('项目路径不是文件夹');
      await shell.trashItem(resolvedPath);
      await broadcastManagedProjects();
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('projects:trash-many', async (_event, folderPaths) => {
    const paths = [...new Set(Array.isArray(folderPaths) ? folderPaths : [])];
    const deleted = [];
    for (const folderPath of paths) {
      try {
        const resolvedPath = await resolveManagedProjectPath(folderPath);
        const stats = await fs.promises.stat(resolvedPath);
        if (!stats.isDirectory()) throw new Error('项目路径不是文件夹');
        await shell.trashItem(resolvedPath);
        deleted.push(resolvedPath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          deleted.push(path.resolve(folderPath));
          continue;
        }
        await broadcastManagedProjects();
        return { ok: false, deleted, error: `${folderPath}：${error.message}` };
      }
    }
    await broadcastManagedProjects();
    return { ok: true, deleted };
  });
  ipcMain.handle('ai:configure', async (_event, configuration) => {
    try {
      const fallbackApiKey = aiConfiguration && configuration?.baseUrl === aiConfiguration.baseUrl ? aiConfiguration.apiKey : '';
      aiConfiguration = normalizeConfiguration(configuration, { fallbackApiKey });
      await persistAIConfiguration(aiConfiguration);
      return { ok: true, configured: true };
    }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('ai:get-status', () => ({ configured: Boolean(aiConfiguration), protocol: aiConfiguration?.protocol || null, baseUrl: aiConfiguration?.baseUrl || null, model: aiConfiguration?.model || null, reasoning: aiConfiguration?.reasoning || null }));
  ipcMain.handle('ai:set-health', (_event, healthy) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:health', Boolean(healthy));
    return { ok: true };
  });
  ipcMain.handle('ai:list-models', async (_event, configuration) => {
    try {
      const fallbackApiKey = aiConfiguration && configuration?.baseUrl === aiConfiguration.baseUrl ? aiConfiguration.apiKey : '';
      const candidate = normalizeConfiguration(configuration, { fallbackApiKey, requireModel: false });
      return { ok: true, ...(await listCompatibleModels(net.fetch, candidate)) };
    } catch (error) {
      return { ok: false, error: error.message, status: error.status || null, requestId: error.requestId || '', endpoint: error.endpoint || '' };
    }
  });
  ipcMain.handle('ai:chat', async (_event, request) => {
    const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
    const controller = new AbortController();
    if (requestId) aiAbortControllers.set(requestId, controller);
    try { return { ok: true, ...(await requestAi(request?.messages, controller.signal)) }; }
    catch (error) { return { ok: false, error: error.message, status: error.status || null, requestId: error.requestId || '', endpoint: error.endpoint || '' }; }
    finally { if (requestId) aiAbortControllers.delete(requestId); }
  });
  ipcMain.handle('ai:abort', (_event, requestId) => {
    const controller = aiAbortControllers.get(requestId);
    if (!controller) return { ok: true, aborted: false };
    controller.abort();
    aiAbortControllers.delete(requestId);
    return { ok: true, aborted: true };
  });
  ipcMain.handle('ai:explain', async (_event, request) => {
    try {
      const text = typeof request?.selectedText === 'string' ? request.selectedText.trim() : '';
      const context = typeof request?.context === 'string' ? request.context.trim().slice(0, 18000) : '';
      if (!text || text.length > 5000) throw new Error('请选择 1 至 5000 个字符');
      const prompt = `请解释“选中内容”。先结合本地知识上下文说明含义，再拆解关键概念，最后给一个帮助理解的例子。\n\n选中内容：\n${text}${context ? `\n\n本地知识上下文：\n${context}` : ''}`;
      return { ok: true, ...(await requestAi([{ role: 'user', content: prompt }])) };
    } catch (error) { return { ok: false, error: error.message, status: error.status || null, requestId: error.requestId || '', endpoint: error.endpoint || '' }; }
  });
  ipcMain.handle('ai:open-browser', (_event, providerId) => {
    try { openBrowserAi(providerId); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('ai:open-sidecar', (_event, request) => {
    try { openAiSidecar(request?.mode, request?.provider, request?.prefill, request?.autoSend); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('ai:hide-sidecar', () => {
    aiSidecarWindow?.hide();
    notifySidecarVisibility(false);
    return { ok: true };
  });
  ipcMain.handle('wallpaper:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('wallpaper:get-current', () => getCurrentWallpaper());
  ipcMain.handle('wallpaper:resolve-url', (_event, value) => resolveWallpaperUrl(value));
  ipcMain.handle('wallpaper:choose-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled) return { ok: true, canceled: true };
    try { return { ok: true, wallpaper: chooseWallpaperProject(result.filePaths[0]) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('document:choose-analysis', async () => {
    try { return await chooseDocumentForAnalysis(); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('mathtype:open', (_event, formula) => {
    const candidates = [path.join('D:', 'Tool', 'Mathtype', 'MathType.exe'), path.join(process.env.ProgramFiles || '', 'MathType', 'MathType.exe')];
    const executable = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (!executable) return { ok: false, error: '未找到 MathType.exe' };
    try {
      spawn(executable, [], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, formula: typeof formula === 'string' ? formula.trim().slice(0, 5000) : '' };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}

process.on('uncaughtException', (error) => logStartup('Uncaught exception', error));
process.on('unhandledRejection', (error) => logStartup('Unhandled rejection', error));

app.whenReady().then(async () => {
  logStartup(`Electron ${process.versions.electron} ready`);
  await migrateUserData(app, logStartup);
  loadLocalSettings();
  updater = createUpdater({ app, getMainWindow: () => mainWindow, log: logStartup });
  updater.configure('stable', { autoUpdate: Boolean(localSettings.autoUpdate) });
  registerIpcHandlers();
  await ensureManagedProjectsRoot();
  await ensureGlobalRoot();
  await startProjectsWatcher();
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    contents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false } } }));
  });
  createWindow();
  if (app.isPackaged && localSettings.autoUpdate) setTimeout(() => updater.check({ manual: false }), 8000);
  app.on('activate', showMainWindow);
}).catch((error) => logStartup('Application startup failed', error));

app.on('before-quit', () => {
  isQuitting = true;
  clearTimeout(projectsWatchTimer);
  projectsWatcher?.close();
  if (globalStarMapProcess && globalStarMapProcess.exitCode === null) globalStarMapProcess.kill();
});
app.on('window-all-closed', () => { if (process.platform === 'darwin' && isQuitting) app.quit(); });
