const STORAGE_KEY = 'lmark.locale';

const ENGLISH = new Map(Object.entries({
  '文件': 'File', '编辑': 'Edit', '视图': 'View', '帮助': 'Help', '主题': 'Theme',
  '工作区': 'Workspace', '休闲区': 'Leisure', '搜索工作区': 'Search workspace', '小游戏': 'Games',
  '小恐龙': 'Dinosaur', '跳跃躲避障碍': 'Jump over obstacles', '俄罗斯方块': 'Tetris', '旋转、消行、挑战高分': 'Rotate, clear lines, score high',
  '项目': 'Projects', '欢迎使用': 'Welcome', '自定义学习': 'Custom learning', '本地工作区': 'Local workspace',
  '没有找到匹配的项目': 'No matching projects', '启用 AI': 'Enable AI', '本地模式': 'Local mode',
  '打开文件': 'Open file', '打开本地文件': 'Open local file', '定制主题': 'Customize theme',
  '把工作空间': 'Make your workspace', '变成你的界面。': 'feel like your own.',
  '一个简洁、快速、可扩展的桌面工作区。你可以从左侧打开项目，也可以从主题面板开始定制自己的视觉环境。': 'A focused, fast and extensible desktop workspace. Open projects on the left or customize the visual environment from Themes.',
  '系统状态': 'System status', '刚刚': 'Now', '工作区已准备好': 'Workspace ready', '渲染引擎': 'Rendering engine',
  '本地知识': 'Local knowledge', '项目知识': 'Project knowledge', '知识文件': 'Knowledge files', '编辑': 'Edit', '预览': 'Preview',
  '保存': 'Save', '默认字体': 'Default font', '字号': 'Size', '字体': 'Font', '备注': 'Note', '文档备注': 'Document note',
  '保存备注': 'Save note', '选择或新建知识文件开始编辑': 'Select or create a knowledge file to begin',
  'PDF 文档': 'PDF document', '休闲区': 'Leisure', '轻松一下': 'Take a break', '准备开始': 'Ready',
  '释放以打开 PDF': 'Drop to open PDF', '本地数据 · 已保存': 'Local data · Saved',
  '打开设置': 'Open settings', '显示/隐藏工作栏': 'Show/hide sidebar', '新建项目': 'New project',
  '新建知识文件': 'New knowledge file', '刷新知识文件': 'Refresh knowledge files', '关闭知识工作区': 'Close knowledge workspace',
  '插入图片': 'Insert image', '导出 PDF': 'Export PDF', '关闭备注': 'Close notes',
  '窗口操作': 'Window', '关闭 LMark': 'Close LMark', '隐藏到托盘': 'Hide to tray', '保留工作状态': 'Keep your workspace running',
  '完全退出': 'Quit', '结束软件的全部进程': 'Stop all application processes', '取消': 'Cancel'
}));

let locale = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh-CN';
let translating = false;

function skip(node) {
  return node.parentElement?.closest('textarea, input, .knowledge-preview, .ai-chat-messages, .knowledge-selection-quote, .knowledge-explain-content, webview');
}

function translateTree(root = document.body) {
  if (locale !== 'en' || translating) return;
  translating = true;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (skip(node)) continue;
    const value = node.nodeValue.trim();
    if (ENGLISH.has(value)) node.nodeValue = node.nodeValue.replace(value, ENGLISH.get(value));
  }
  root.querySelectorAll?.('[title],[aria-label],[placeholder]').forEach((element) => {
    for (const name of ['title', 'aria-label', 'placeholder']) {
      const value = element.getAttribute(name);
      if (ENGLISH.has(value)) element.setAttribute(name, ENGLISH.get(value));
    }
  });
  translating = false;
}

export function getLocale() { return locale; }
export function t(chinese, english) { return locale === 'en' ? (english || ENGLISH.get(chinese) || chinese) : chinese; }

export function setLocale(next) {
  const normalized = next === 'en' ? 'en' : 'zh-CN';
  if (normalized === locale) return;
  localStorage.setItem(STORAGE_KEY, normalized);
  location.reload();
}

export function createI18nController() {
  document.documentElement.lang = locale;
  if (locale === 'en') {
    translateTree(document.body);
    const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) translateTree(node);
      else if (node.nodeType === Node.TEXT_NODE && !skip(node)) {
        const value = node.nodeValue.trim();
        if (ENGLISH.has(value)) node.nodeValue = node.nodeValue.replace(value, ENGLISH.get(value));
      }
    })));
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return { locale, setLocale, t };
}
