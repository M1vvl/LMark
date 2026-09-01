import { renderLatexFormula } from './modules/knowledge/formula-renderer.js';
import { createAIKnowledgeWriter } from './modules/ai-knowledge-writer.js';
import { createConversationStore } from './modules/ai-conversations.js';

const SETTINGS_KEY = 'codex-ai-settings-v2';
const MODELS = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.3-codex-spark', 'Codex-auto-review', 'gpt-5.5', 'gpt-image-2'];
const PROVIDERS = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/', partition: 'persist:ai-chatgpt' },
  claude: { label: 'Claude', url: 'https://claude.ai/', partition: 'persist:ai-claude' },
  kimi: { label: 'Kimi', url: 'https://www.kimi.com/', partition: 'persist:ai-kimi' },
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com/', partition: 'persist:ai-deepseek' }
};

const $ = (id) => document.getElementById(id);
const settings = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } })();
const conversationStore = createConversationStore(localStorage);
let activeConversation = conversationStore.current();
let messages = activeConversation.messages;
let currentMode = 'api';
let currentProvider = 'chatgpt';
let serviceName = '兼容 API';
let browserView;
let sending = false;
let requestId = '';
let historyContextMenu;
const knowledgeWriter = createAIKnowledgeWriter(window.desktopAPI);
const selectionAskButton = document.createElement('button');
selectionAskButton.className = 'selection-followup-button';
selectionAskButton.type = 'button';
selectionAskButton.textContent = '询问 AI';
selectionAskButton.hidden = true;
document.body.append(selectionAskButton);

function applyTheme() {
  try {
    const theme = JSON.parse(localStorage.getItem('codex-desktop-theme') || '{}');
    document.body.classList.toggle('light-theme', theme.mode === 'light');
    if (theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);
  } catch { /* Use defaults when the main window has no theme yet. */ }
}

function persistMessages() {
  activeConversation = conversationStore.updateMessages(activeConversation.id, messages) || activeConversation;
  messages = activeConversation.messages;
  renderHistory();
}
function persistSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, model: $('modelSelect').value, reasoning: $('reasoningSelect').value })); }

function conversationDate(value) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function closeHistoryContextMenu() {
  historyContextMenu?.remove();
  historyContextMenu = null;
}

function confirmConversationDelete(conversation) {
  closeHistoryContextMenu();
  const overlay = document.createElement('div');
  overlay.className = 'history-delete-overlay';
  overlay.innerHTML = '<section class="history-delete-dialog" role="dialog" aria-modal="true"><span>历史对话</span><h2>删除这段对话？</h2><p data-title></p><div><button type="button" data-cancel>取消</button><button class="danger" type="button" data-delete>删除</button></div></section>';
  overlay.querySelector('[data-title]').textContent = conversation.title;
  const close = () => overlay.remove();
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-delete]').addEventListener('click', () => {
    if (!conversationStore.remove(conversation.id)) {
      overlay.querySelector('[data-title]').textContent = '至少需要保留一个对话。';
      return;
    }
    close();
    if (activeConversation.id === conversation.id) selectConversation(conversationStore.current());
    else renderHistory();
  });
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);
}

function openHistoryContextMenu(conversation, x, y) {
  closeHistoryContextMenu();
  historyContextMenu = document.createElement('div');
  historyContextMenu.className = 'history-context-menu';
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = '删除对话';
  deleteButton.addEventListener('click', () => confirmConversationDelete(conversation));
  historyContextMenu.append(deleteButton);
  document.body.append(historyContextMenu);
  historyContextMenu.style.left = `${Math.min(x, window.innerWidth - historyContextMenu.offsetWidth - 8)}px`;
  historyContextMenu.style.top = `${Math.min(y, window.innerHeight - historyContextMenu.offsetHeight - 8)}px`;
}

function selectConversation(conversation) {
  if (!conversation || sending) return;
  activeConversation = conversation;
  messages = activeConversation.messages;
  $('historyPanel').hidden = true;
  selectionAskButton.hidden = true;
  renderMessages();
  renderHistory();
  $('chatInput').focus();
}

function renderHistory() {
  const list = $('historyList');
  list.replaceChildren();
  for (const conversation of conversationStore.list()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.classList.toggle('active', conversation.id === activeConversation.id);
    const title = document.createElement('strong');
    title.textContent = conversation.title;
    const metadata = document.createElement('span');
    metadata.textContent = `${conversationDate(conversation.updatedAt)} · ${conversation.messages.length} 条消息${conversation.parentId ? ' · Fork' : ''}`;
    button.append(title, metadata);
    button.addEventListener('click', () => selectConversation(conversationStore.get(conversation.id)));
    button.addEventListener('contextmenu', (event) => { event.preventDefault(); openHistoryContextMenu(conversation, event.clientX, event.clientY); });
    list.append(button);
  }
}

function startConversation() {
  selectConversation(conversationStore.create());
}

function forkConversation() {
  if (!messages.length || sending) return;
  const branch = conversationStore.fork(activeConversation.id);
  if (branch) selectConversation(branch);
}

function updateSelectionAction() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) { selectionAskButton.hidden = true; return; }
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
  const selectedText = selection.toString().trim();
  if (!$('messages').contains(ancestor) || selectedText.length < 2 || selectedText.length > 5000) { selectionAskButton.hidden = true; return; }
  const rect = range.getBoundingClientRect();
  selectionAskButton.dataset.selectedText = selectedText;
  selectionAskButton.style.left = `${Math.min(window.innerWidth - 92, Math.max(8, rect.right - 82))}px`;
  selectionAskButton.style.top = `${Math.min(window.innerHeight - 40, Math.max(48, rect.bottom + 6))}px`;
  selectionAskButton.hidden = false;
}

function renderMessageContent(target, content) {
  const pattern = /(\$\$)([\s\S]+?)\1|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|\$([^$\n]+?)\$/g;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    if (match.index > cursor) target.append(document.createTextNode(content.slice(cursor, match.index)));
    const source = match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
    target.append(renderLatexFormula(source, { display: Boolean(match[2] !== undefined || match[3] !== undefined) }));
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    const remainder = content.slice(cursor);
    const chunks = remainder.split(/(\r?\n)/);
    chunks.forEach((chunk) => {
      if (/\\(?:theta|ast|arg|min|max|sum|mathcal|frac|mathbf|sqrt)|∑|∫/.test(chunk) && chunk.trim().length > 3) target.append(renderLatexFormula(chunk.trim(), { display: true }));
      else target.append(document.createTextNode(chunk));
    });
  }
}

function renderMessages() {
  const target = $('messages');
  target.replaceChildren();
  if (!messages.length) { const empty = document.createElement('div'); empty.className = 'chat-empty'; empty.textContent = '配置完成后，从这里开始和本地知识对话。'; target.append(empty); return; }
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const item = document.createElement('article'); item.className = `message ${message.role}`;
    const role = document.createElement('span'); role.className = 'message-role'; role.textContent = message.role === 'user' ? '你' : 'AI';
    const body = document.createElement('div'); body.className = 'message-content'; renderMessageContent(body, message.content);
    item.append(role, body);
    if (message.role === 'assistant' && message.reasoning) {
      const details = document.createElement('details'); details.className = 'reasoning-summary';
      const summary = document.createElement('summary'); summary.textContent = '思路摘要';
      const text = document.createElement('div'); text.textContent = message.reasoning;
      details.append(summary, text); item.append(details);
    }
    if (message.role === 'assistant') {
      const prompt = [...messages.slice(0, index)].reverse().find((entry) => entry.role === 'user')?.content || '';
      knowledgeWriter.decorateMessage(item, message.content, prompt);
    }
    target.append(item);
  }
  target.scrollTop = target.scrollHeight;
}

function setThinkingIndicator(visible) {
  const target = $('messages');
  target.querySelector('.ai-thinking-indicator')?.remove();
  if (!visible) return;
  const item = document.createElement('article'); item.className = 'message assistant ai-thinking-indicator';
  item.innerHTML = '<span class="message-role">AI</span><span class="thinking-label">正在整理思路<span class="thinking-dots">...</span></span>';
  target.append(item); target.scrollTop = target.scrollHeight;
}

function setSending(value) {
  sending = value;
  const button = $('sendButton');
  button.classList.toggle('is-stop', value);
  button.title = value ? '中断' : '发送';
  button.setAttribute('aria-label', value ? '中断' : '发送');
}

function setMode(mode, provider = currentProvider) {
  currentMode = mode === 'browser' ? 'browser' : 'api';
  currentProvider = PROVIDERS[provider] ? provider : 'chatgpt';
  $('apiView').hidden = currentMode !== 'api';
  $('browserView').hidden = currentMode !== 'browser';
  // Browser sessions are a temporary web surface: conversation history, Fork,
  // and new-chat actions only belong to the configured API assistant.
  for (const id of ['sidecarHistoryButton', 'sidecarForkButton', 'sidecarNewChatButton']) {
    $(id).hidden = currentMode !== 'api';
  }
  $('sidecarEyebrow').textContent = currentMode === 'api' ? 'API 助手' : '浏览器 AI';
  $('sidecarTitle').textContent = currentMode === 'api' ? `${serviceName} 对话` : PROVIDERS[currentProvider].label;
  if (currentMode === 'browser') {
    $('providerSelect').value = currentProvider;
    browserView?.remove();
    browserView = document.createElement('webview');
    browserView.className = 'browser-frame';
    browserView.setAttribute('partition', PROVIDERS[currentProvider].partition);
    browserView.setAttribute('allowpopups', '');
    browserView.src = PROVIDERS[currentProvider].url;
    $('browserHost').replaceChildren(browserView);
  }
}

async function loadStatus() {
  const status = await window.desktopAPI?.getAIStatus();
  if (status?.configured) {
    settings.baseUrl = status.baseUrl || settings.baseUrl;
    settings.model = status.model || settings.model;
    settings.protocol = status.protocol || settings.protocol;
    settings.reasoning = status.reasoning || settings.reasoning || 'medium';
    try { serviceName = new URL(status.baseUrl).hostname.replace(/^api\./, '') || serviceName; } catch { /* Keep generic service label. */ }
  }
  const values = [settings.model, ...MODELS].filter((value, index, list) => value && list.indexOf(value) === index);
  $('modelSelect').replaceChildren(...values.map((value) => { const option = document.createElement('option'); option.value = value; option.textContent = value; return option; }));
  $('modelSelect').value = settings.model || values[0];
  $('reasoningSelect').value = settings.reasoning || 'medium';
  persistSettings();
}

async function submitMessage() {
  if (sending) { if (requestId) await window.desktopAPI?.abortAI(requestId); return; }
  const content = $('chatInput').value.trim();
  if (!content) return;
  messages.push({ role: 'user', content }); persistMessages(); $('chatInput').value = ''; renderMessages();
  requestId = `sidecar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setSending(true);
  setThinkingIndicator(true);
  const result = await window.desktopAPI?.chatWithAI(messages, requestId);
  if (result?.ok) { messages.push({ role: 'assistant', content: result.content, reasoning: result.reasoningSummary || '' }); persistMessages(); await window.desktopAPI?.setAIHealth(true); }
  else if (result?.error !== '请求已中断') { await window.desktopAPI?.setAIHealth(false); setMode('browser', currentProvider); }
  requestId = '';
  setSending(false);
  setThinkingIndicator(false);
  renderMessages();
  $('chatInput').focus();
}

$('chatForm').addEventListener('submit', (event) => { event.preventDefault(); submitMessage(); });
$('chatInput').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitMessage(); } });
$('sendButton').addEventListener('click', (event) => { if (sending) { event.preventDefault(); submitMessage(); } });
$('sidecarHideButton').addEventListener('click', () => window.desktopAPI?.hideAISidecar());
$('sidecarHistoryButton').addEventListener('click', () => { $('historyPanel').hidden = !$('historyPanel').hidden; if (!$('historyPanel').hidden) renderHistory(); });
$('historyCloseButton').addEventListener('click', () => { $('historyPanel').hidden = true; });
$('sidecarNewChatButton').addEventListener('click', startConversation);
$('sidecarForkButton').addEventListener('click', forkConversation);
$('historyPanel').addEventListener('pointerdown', (event) => event.stopPropagation());
selectionAskButton.addEventListener('click', () => {
  const selected = selectionAskButton.dataset.selectedText || '';
  if (!selected) return;
  $('chatInput').value = `请基于当前对话进一步解释、举例并纠正下面这段内容：\n\n${selected}`;
  selectionAskButton.hidden = true;
  window.getSelection()?.removeAllRanges();
  $('chatInput').focus();
});
document.addEventListener('selectionchange', () => requestAnimationFrame(updateSelectionAction));
document.addEventListener('pointerdown', (event) => { if (historyContextMenu && !event.target.closest('.history-context-menu')) closeHistoryContextMenu(); });
$('modelSelect').addEventListener('change', async () => { settings.model = $('modelSelect').value; persistSettings(); await window.desktopAPI?.configureAI({ ...settings, apiKey: '' }); });
$('reasoningSelect').addEventListener('change', async () => { settings.reasoning = $('reasoningSelect').value; persistSettings(); await window.desktopAPI?.configureAI({ ...settings, apiKey: '' }); });
$('providerSelect').addEventListener('change', (event) => setMode('browser', event.target.value));
$('reloadButton').addEventListener('click', () => browserView?.reload());
$('openWindowButton').addEventListener('click', () => window.desktopAPI?.openBrowserAI(currentProvider));
window.desktopAPI?.onAISidecarMode((state) => {
  setMode(state?.mode, state?.provider);
  if (state?.prefill && currentMode === 'api') {
    $('chatInput').value = state.prefill;
    $('chatInput').focus();
    if (state.autoSend) setTimeout(() => submitMessage(), 0);
  }
});
applyTheme();
loadStatus();
renderMessages();
renderHistory();
