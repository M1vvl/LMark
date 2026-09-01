const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov']);

function unique(values) { return [...new Set(values.filter(Boolean).map((item) => path.resolve(item)))]; }

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function installationCandidates() {
  return unique([
    'D:\\Game\\steamapps\\common\\wallpaper_engine',
    process.env.WALLPAPER_ENGINE_DIR,
    path.join(process.env.ProgramFiles || '', 'Steam', 'steamapps', 'common', 'wallpaper_engine'),
    path.join(process.env.ProgramFiles || '', 'SteamLibrary', 'steamapps', 'common', 'wallpaper_engine')
  ]).filter((item) => fs.existsSync(item));
}

function currentProjectFile(installDir) {
  const config = readJson(path.join(installDir, 'config.json'));
  const account = Object.values(config || {}).find((value) => value?.general?.wallpaperconfig?.selectedwallpapers);
  const selected = account?.general?.wallpaperconfig?.selectedwallpapers || {};
  const first = Object.values(selected).find((item) => typeof item?.file === 'string')?.file;
  return first && fs.existsSync(first) ? first : '';
}

function metadataFor(filePath) {
  const absolute = path.resolve(filePath);
  const projectDir = fs.statSync(absolute).isDirectory() ? absolute : path.dirname(absolute);
  const project = readJson(path.join(projectDir, 'project.json')) || {};
  const preview = project.preview && fs.existsSync(path.join(projectDir, project.preview)) ? path.join(projectDir, project.preview) : '';
  const extension = path.extname(absolute).toLowerCase();
  const type = IMAGE_EXTENSIONS.has(extension) ? 'image' : VIDEO_EXTENSIONS.has(extension) ? 'video' : extension === '.html' ? 'web' : extension === '.pkg' || project.type === 'scene' ? 'scene' : 'unknown';
  const mediaPath = type === 'scene' || type === 'web' ? preview : absolute;
  return { id: path.basename(projectDir), title: project.title || path.basename(projectDir), type, path: absolute, preview: mediaPath || '', url: mediaPath ? pathToFileURL(mediaPath).href : '', installDir: projectDir };
}

function getCurrentWallpaper() {
  const installDir = installationCandidates()[0];
  if (!installDir) return { ok: false, error: '未找到 Wallpaper Engine 安装目录' };
  const selected = currentProjectFile(installDir);
  if (!selected) return { ok: false, error: 'Wallpaper Engine 没有可读取的当前壁纸' };
  return { ok: true, installation: installDir, wallpaper: metadataFor(selected), fallback: metadataFor(selected).type === 'scene' };
}

function chooseProject(directory) {
  if (!directory || !fs.existsSync(directory)) throw new Error('Wallpaper Engine 项目路径不存在');
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const candidate = entries.find((entry) => entry.isFile() && (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || entry.name.toLowerCase() === 'index.html'));
  const pkg = entries.find((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.pkg');
  const projectJson = fs.existsSync(path.join(directory, 'project.json')) ? path.join(directory, 'project.json') : '';
  if (projectJson || candidate || pkg) return metadataFor(projectJson ? directory : path.join(directory, (candidate || pkg).name));
  throw new Error('所选文件夹不是可识别的 Wallpaper Engine 项目');
}

function resolveWallpaperUrl(value) {
  const input = String(value || '').trim();
  if (!input) return { ok: false, error: '壁纸地址为空' };
  let parsed;
  try { parsed = new URL(input); } catch { parsed = null; }
  const id = parsed?.searchParams.get('id') || input.match(/(?:^|[^0-9])(\d{6,})(?:$|[^0-9])/)?.[1];
  if (id) {
    const roots = unique([
      'D:\\Game\\steamapps\\workshop\\content\\431960',
      ...installationCandidates().map((item) => path.join(path.dirname(path.dirname(item)), 'workshop', 'content', '431960'))
    ]);
    const projectDir = roots.map((root) => path.join(root, id)).find((candidate) => fs.existsSync(candidate));
    if (!projectDir) return { ok: false, error: `已识别 Workshop 项目 ${id}，但本机尚未下载该壁纸` };
    return { ok: true, sourceUrl: input, wallpaper: metadataFor(projectDir) };
  }
  if (parsed && /^https?:$/.test(parsed.protocol) && /\.(png|jpe?g|webp|gif|mp4|webm)(?:$|[?#])/i.test(parsed.pathname)) {
    const extension = path.extname(parsed.pathname).toLowerCase();
    return { ok: true, sourceUrl: input, wallpaper: { type: VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image', title: parsed.pathname.split('/').pop() || '远程壁纸', url: input, preview: input, path: input } };
  }
  return { ok: false, error: '壁纸地址必须是已下载的 Steam Workshop 链接，或图片/视频直链' };
}

module.exports = { getCurrentWallpaper, chooseProject, resolveWallpaperUrl, metadataFor, installationCandidates };
