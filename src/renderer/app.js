import { createThemeController } from './modules/theme.js';
import { createWorkspaceController } from './modules/workspace.js';
import { createWindowController } from './modules/window-controls.js';
import { createMenuController } from './modules/menu.js';
import { createGelSidebar } from './modules/sidebar-visual/gel-sidebar.js';
import { createWorkspaceBars } from './modules/workspace-bars.js';
import { createAIController } from './modules/ai-chat.js';
import { createKnowledgeWorkspace } from './modules/knowledge-workspace.js';
import { createLeisureController } from './modules/leisure/leisure.js';
import { createDocumentViewer } from './modules/document-viewer/document-viewer.js';
import { createI18nController } from './modules/i18n.js';
import { createGlobalController } from './modules/global/global.js';
import { createOnboardingController } from './modules/onboarding/onboarding.js';

const toast = document.getElementById('toast');
let toastTimer;
function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2200); }

const theme = createThemeController({ onToast: showToast });
window.desktopAPI?.onUpdateEvent((name, payload) => {
  if (name === 'available') theme.showUpdatePrompt(payload);
  if (name === 'none' && payload?.manual) showToast('当前已是最新版本');
  if (name === 'downloaded') {
    const prompt = document.getElementById('updatePrompt');
    const button = prompt?.querySelector('[data-update-confirm]');
    if (button) { button.disabled = false; button.textContent = '重启安装'; button.onclick = () => window.desktopAPI?.installUpdate(); }
  }
});
const i18n = createI18nController();
createWorkspaceController({ onToast: showToast });
createLeisureController({ onToast: showToast });
createGlobalController({ onToast: showToast });
const onboarding = createOnboardingController();
createGelSidebar();
createWorkspaceBars({ onToast: showToast });
createAIController({ onToast: showToast });
createKnowledgeWorkspace({ onToast: showToast });
const documentViewer = createDocumentViewer({ onToast: showToast });
createWindowController({ onToast: showToast });
createMenuController({ onAction: (action) => {
  if (action === 'theme') theme.openPanel({ themeOnly: true, expandTheme: true });
  else if (action === 'toggle-sidebar') document.dispatchEvent(new Event('workspace:toggle'));
  else if (action === 'open') openFile();
  else if (action === 'analyze') openDocumentForAnalysis();
  else if (action === 'language-zh') i18n.setLocale('zh-CN');
  else if (action === 'language-en') i18n.setLocale('en');
  else if (action === 'feedback') showToast('Email: 1070764333@qq.com · QQ: 1070764333 · WeChat: _9C2cyo');
  else if (action === 'onboarding') onboarding.openFromHelp();
  else showToast(i18n.t('功能已就绪', 'Ready'));
} });

async function openFile() {
  const selected = await window.desktopAPI?.openFile();
  if (!selected) return;
  if (/\.pdf$/i.test(selected)) await documentViewer.openPath(selected);
  else showToast(`已选择：${selected.split('\\').pop()}`);
}

async function openDocumentForAnalysis() {
  const result = await window.desktopAPI?.chooseDocumentForAnalysis();
  if (!result?.ok) { showToast(`文档读取失败：${result?.error || '未知错误'}`); return; }
  if (result.canceled) return;
  const prompt = `请作为论文与技术文献助手，分析下面导入的文档。输出：1. 一句话摘要；2. 研究问题与方法；3. 关键概念/公式；4. 主要证据与结论；5. 局限性；6. 可行动的学习路径。保留原文中的术语与标题，不要编造文档中没有的结果。\n\n文件：${result.name}\n\n${result.content}`;
  const opened = await window.desktopAPI?.openAISidecar('api', 'chatgpt', prompt);
  if (!opened?.ok) showToast(`无法打开 AI 侧栏：${opened?.error || '未知错误'}`);
  else showToast(`已载入 ${result.name}，请在 AI 侧栏中确认分析请求`);
}

const themeButton = document.getElementById('themeButton');
const settingsButton = document.getElementById('settingsButton');
themeButton.onclick = () => theme.openPanel({ themeOnly: true, expandTheme: true, anchor: themeButton, placement: 'below' });
document.getElementById('welcomeThemeButton')?.addEventListener('click', (event) => theme.openPanel({ themeOnly: true, expandTheme: true, anchor: event.currentTarget, placement: 'above' }));
settingsButton.onclick = () => theme.openPanel({ anchor: settingsButton, placement: 'above' });
document.getElementById('openFileButton')?.addEventListener('click', openFile);
document.getElementById('welcomeOpenButton')?.addEventListener('click', openFile);
setTimeout(() => onboarding.maybeOpen(), 450);
document.addEventListener('workspace:mode-changed', (event) => {
  if (event.detail?.mode === 'global') setTimeout(() => onboarding.maybeOpenGlobal(), 320);
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector('.workspace-search input').focus(); }
  if (event.key === 'Escape') theme.closePanel();
});
