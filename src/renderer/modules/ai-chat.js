const SETTINGS_KEY = 'codex-ai-settings-v2';
const CONVERSATION_KEY = 'codex-ai-conversation-v1';

const DEFAULT_SETTINGS = Object.freeze({ provider: 'custom', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', protocol: 'auto', reasoning: 'medium' });
const SUGGESTED_MODELS = Object.freeze(['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.3-codex-spark', 'Codex-auto-review', 'gpt-5.5', 'gpt-image-2']);

const BROWSER_PROVIDERS = Object.freeze({
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/', partition: 'persist:ai-chatgpt' },
  claude: { label: 'Claude', url: 'https://claude.ai/', partition: 'persist:ai-claude' },
  kimi: { label: 'Kimi', url: 'https://www.kimi.com/', partition: 'persist:ai-kimi' },
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com/', partition: 'persist:ai-deepseek' }
});

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      provider: 'custom',
      baseUrl: stored.baseUrl || DEFAULT_SETTINGS.baseUrl,
      model: stored.model || DEFAULT_SETTINGS.model,
      protocol: ['auto', 'responses', 'chat-completions'].includes(stored.protocol) ? stored.protocol : 'auto',
      reasoning: ['low', 'medium', 'high', 'xhigh'].includes(stored.reasoning) ? stored.reasoning : 'medium'
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function serviceLabel(baseUrl) {
  try { return new URL(baseUrl).hostname.replace(/^api\./, '') || '兼容 API'; }
  catch { return '兼容 API'; }
}

function externalLinkIcon() {
  return '<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="15" height="15" rx="2"></rect><path d="M12 3h9v9"></path><path d="m11 13 10-10"></path></svg>';
}

function createMessage(role, content, onSave) {
  const message = document.createElement('article');
  message.className = `ai-message ${role}`;
  const roleLabel = document.createElement('div');
  roleLabel.className = 'ai-message-role';
  roleLabel.textContent = role === 'user' ? '你' : 'AI';
  const body = document.createElement('div');
  body.textContent = content;
  message.append(roleLabel, body);
  if (role === 'assistant' && onSave) {
    const actions = document.createElement('div');
    actions.className = 'ai-message-actions';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = '保存到项目';
    saveButton.addEventListener('click', () => onSave(content));
    actions.append(saveButton);
    message.append(actions);
  }
  return message;
}

function validBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  } catch { return false; }
}

// Keep the value users copy between providers predictable. The main process
// accepts either a base URL or a concrete endpoint, but showing one canonical
// Responses endpoint prevents malformed paths such as `/v1/v1/responses`.
function normalizeEndpointInput(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.search = '';
    url.hash = '';
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(path) || /\/responses$/i.test(path)) return url.toString().replace(/\/+$/, '');
    url.pathname = `${path || ''}${/\/v\d+(?:alpha|beta\d*)?$/i.test(path) ? '' : '/v1'}/responses`;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function endpointRoot(value) {
  const normalized = normalizeEndpointInput(value);
  try {
    const url = new URL(normalized);
    url.pathname = url.pathname.replace(/\/(?:responses|chat\/completions)$/i, '');
    return url.toString().replace(/\/+$/, '');
  } catch { return normalized; }
}

function readConversation() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERSATION_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string').slice(-100) : [];
  } catch { return []; }
}

export function createAIController({ onToast }) {
  const button = document.getElementById('aiModeButton');
  const panel = document.getElementById('aiChatPanel');
  const welcome = document.querySelector('.welcome-view');
  const messagesElement = document.getElementById('aiChatMessages');
  const form = document.getElementById('aiChatForm');
  const input = document.getElementById('aiChatInput');
  const sendButton = document.getElementById('aiChatSendButton');
  const title = document.getElementById('aiChatTitle');
  const closeButton = document.getElementById('closeAiChatButton');
  const clearChatButton = document.getElementById('clearAiChatButton');
  const browserPanel = document.getElementById('aiBrowserPanel');
  const browserHost = document.getElementById('aiBrowserHost');
  const browserTitle = document.getElementById('aiBrowserTitle');
  const closeBrowserButton = document.getElementById('closeAiBrowserButton');
  const reloadBrowserButton = document.getElementById('reloadAiBrowserButton');
  const openBrowserWindowButton = document.getElementById('openAiBrowserWindowButton');
  const appShell = document.getElementById('appShell');
  const sidecar = document.getElementById('aiSidecar');
  const restoreSidecarButton = document.getElementById('showAiSidecarButton');
  const dockResizer = document.getElementById('aiDockResizer');
  const knowledgePanel = document.getElementById('knowledgePanel');
  if (!button || !panel || !form) return;

  let settings = readSettings();
  let configured = false;
  let configuredBaseUrl = '';
  let menu;
  let sending = false;
  let activeBrowserView;
  let activeBrowserProvider = 'chatgpt';
  let activeSidecarMode = 'api';
  let dockWidth = Math.min(72, Math.max(28, Number(localStorage.getItem('codex-ai-dock-width')) || 50));
  let activeProject = null;
  const messages = readConversation();
  const modelSelect = document.getElementById('aiChatModelSelect');
  const reasoningSelect = document.getElementById('aiReasoningSelect');
  let requestId = '';

  function setApiIndicator(ready) {
    document.querySelectorAll('#aiModeButton .ai-status-dot').forEach((dot) => dot.classList.toggle('configured', Boolean(ready)));
  }

  function persistMessages() {
    localStorage.setItem(CONVERSATION_KEY, JSON.stringify(messages.slice(-100)));
  }

  window.desktopAPI?.getAIStatus().then((status) => {
    configured = Boolean(status?.configured);
    setApiIndicator(configured);
    configuredBaseUrl = status?.baseUrl || '';
    if (configured) {
      settings = { ...settings, baseUrl: status.baseUrl || settings.baseUrl, model: status.model || settings.model, protocol: status.protocol || settings.protocol, reasoning: status.reasoning || settings.reasoning };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  });

  function renderMessages() {
    messagesElement.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'ai-chat-empty';
      empty.textContent = '完成 API 配置后，可以在这里开始本机 AI 对话。';
      messagesElement.append(empty);
      return;
    }
    messages.forEach((message) => messagesElement.append(createMessage(message.role, message.content, activeProject?.path ? openSaveKnowledgeModal : null)));
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function showChat() {
    activeSidecarMode = 'api';
    window.desktopAPI?.openAISidecar('api');
    return;
    /* The legacy in-window surface remains below as a fallback for old profiles. */
    browserPanel.hidden = true;
    panel.hidden = false;
    sidecar.hidden = false;
    appShell.classList.add('ai-sidecar-open');
    restoreSidecarButton.hidden = true;
    title.textContent = `${serviceLabel(settings.baseUrl)} 对话`;
    reasoningSelect.value = settings.reasoning || 'medium';
    modelSelect.replaceChildren(...[settings.model, ...SUGGESTED_MODELS].filter((value, index, list) => value && list.indexOf(value) === index).map((value) => { const option = document.createElement('option'); option.value = value; option.textContent = value; return option; }));
    modelSelect.value = settings.model;
    renderMessages();
    requestAnimationFrame(() => input.focus());
  }

  function hideChat() {
    window.desktopAPI?.hideAISidecar();
    return;
    panel.hidden = true;
    sidecar.hidden = true;
    appShell.classList.remove('ai-sidecar-open');
    restoreSidecarButton.hidden = !browserPanel.hidden;
  }

  function showBrowserWorkspace(providerId) {
    const provider = BROWSER_PROVIDERS[providerId];
    if (!provider) return;
    closeMenu();
    activeSidecarMode = 'browser';
    window.desktopAPI?.openAISidecar('browser', providerId);
    return;
    activeBrowserProvider = providerId;
    activeBrowserView?.remove();
    browserPanel.hidden = false;
    sidecar.hidden = false;
    appShell.classList.add('ai-sidecar-open');
    panel.hidden = true;
    restoreSidecarButton.hidden = true;
    browserTitle.textContent = provider.label;
    browserHost.replaceChildren();
    const view = document.createElement('webview');
    view.className = 'ai-browser-view';
    view.setAttribute('partition', provider.partition);
    view.setAttribute('allowpopups', '');
    view.setAttribute('aria-label', `${provider.label} 浏览器工作区`);
    view.src = provider.url;
    view.addEventListener('did-fail-load', (event) => {
      if (event.errorCode !== -3) onToast(`${provider.label} 加载失败：${event.errorDescription}`);
    });
    browserHost.append(view);
    activeBrowserView = view;
    onToast(`${provider.label} 已在软件右侧侧栏打开`);
  }

  function hideBrowserWorkspace() {
    window.desktopAPI?.hideAISidecar();
    return;
    browserPanel.hidden = true;
    appShell.classList.remove('ai-sidecar-open');
    sidecar.hidden = true;
    restoreSidecarButton.hidden = false;
  }

  function setDockWidth(nextWidth) {
    dockWidth = Math.min(72, Math.max(28, nextWidth));
    appShell.style.setProperty('--ai-sidecar-width', `${dockWidth}vw`);
    localStorage.setItem('codex-ai-dock-width', String(dockWidth));
  }

  function closeMenu() {
    menu?.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
  }

  function openSaveKnowledgeModal(content) {
    if (!activeProject?.path) { onToast('请先选择一个关联文件夹的项目'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'project-modal-overlay';
    overlay.innerHTML = '<section class="project-modal" role="dialog" aria-modal="true"><div class="project-modal-header"><p class="eyebrow">知识文件</p><h3>保存到项目</h3><p class="project-modal-description"></p></div><div class="project-modal-body"><label class="project-name-field"><span>文件名称</span><input type="text" maxlength="80" autocomplete="off" /></label></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-cancel>取消</button><button class="jelly-confirm-button" data-save>保存</button></div></section>';
    overlay.querySelector('.project-modal-description').textContent = `将在“${activeProject.name}”文件夹中创建新的 Markdown 文件。`;
    const input = overlay.querySelector('input');
    const firstLine = content.split(/\r?\n/).find((line) => line.trim()) || '学习笔记';
    input.value = firstLine.replace(/^#+\s*/, '').replace(/[<>:"/\\|?*]/g, '').slice(0, 36) || '学习笔记';
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.querySelector('[data-save]').addEventListener('click', async () => {
      const fileName = input.value.trim();
      if (!fileName) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      const saveButton = overlay.querySelector('[data-save]');
      saveButton.disabled = true;
      const result = await window.desktopAPI?.writeKnowledgeFile(activeProject.path, fileName, content);
      saveButton.disabled = false;
      if (!result?.ok) { onToast(`保存失败：${result?.error || '未知错误'}`); return; }
      close();
      document.dispatchEvent(new CustomEvent('knowledge:open', { detail: activeProject }));
      document.dispatchEvent(new Event('knowledge:refresh'));
      onToast(`已保存知识文件：${result.file.name}`);
    });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') overlay.querySelector('[data-save]').click(); });
    overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
    document.body.append(overlay);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  function openConfigModal() {
    closeMenu();
    const overlay = document.createElement('div');
    overlay.className = 'project-modal-overlay';
    overlay.innerHTML = `<section class="project-modal ai-config-modal" role="dialog" aria-modal="true"><div class="project-modal-header"><p class="eyebrow">AI 配置</p><h3>配置 OpenAI 兼容 API</h3><p class="project-modal-description">只需填写 API 端点、模型和密钥。密钥由 Windows 当前用户加密保存，不会写入软件安装包。</p></div><div class="project-modal-body ai-config-grid"><label><span>API 端点</span><input type="url" data-base-url autocomplete="off" placeholder="https://api.example.com/v1" /></label><p class="ai-endpoint-preview" data-endpoint-preview></p><label><span>模型</span><div class="ai-model-picker"><input type="text" data-model list="aiModelOptions" maxlength="160" autocomplete="off" /><button class="jelly-settings-button compact" type="button" data-fetch-models>获取模型</button></div></label><datalist id="aiModelOptions" data-model-options></datalist><p class="ai-model-status" data-model-status></p><label><span>API 密钥</span><input type="password" data-api-key maxlength="2048" autocomplete="off" placeholder="已配置时可留空" /></label><details class="ai-advanced-settings"><summary>高级设置</summary><label><span>请求协议</span><select data-protocol><option value="auto">自动识别</option><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></label></details><p class="ai-config-note">软件会读取 /v1/models；自动模式会在 Responses 与 Chat Completions 间兼容切换。服务端不提供模型列表时仍可手动输入模型名称。</p></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-cancel>取消</button><button class="jelly-cancel-button" data-test>测试连接</button><button class="jelly-confirm-button" data-save>保存并打开</button></div><p class="ai-config-test-status" data-test-status role="status" aria-live="polite"></p></section>`;
    document.body.append(overlay);
    const baseUrlInput = overlay.querySelector('[data-base-url]');
    const modelInput = overlay.querySelector('[data-model]');
    const keyInput = overlay.querySelector('[data-api-key]');
    const protocolSelect = overlay.querySelector('[data-protocol]');
    const endpointPreview = overlay.querySelector('[data-endpoint-preview]');
    const modelOptions = overlay.querySelector('[data-model-options]');
    const modelStatus = overlay.querySelector('[data-model-status]');
    const testStatus = overlay.querySelector('[data-test-status]');
    const fetchModelsButton = overlay.querySelector('[data-fetch-models]');
    baseUrlInput.value = settings.baseUrl;
    modelInput.value = settings.model;
    protocolSelect.value = settings.protocol || 'auto';
    modelOptions.replaceChildren(...SUGGESTED_MODELS.map((model) => {
      const option = document.createElement('option');
      option.value = model;
      return option;
    }));
    const close = () => overlay.remove();
    const updateEndpointPreview = () => {
      const base = endpointRoot(baseUrlInput.value);
      if (!base) { endpointPreview.textContent = ''; return; }
      const root = /\/v\d+(?:alpha|beta\d*)?$/i.test(base) ? base : `${base}/v1`;
      const protocol = protocolSelect.value;
      endpointPreview.textContent = protocol === 'responses'
        ? `Responses：${root}/responses`
        : protocol === 'chat-completions'
          ? `Chat Completions：${root}/chat/completions`
          : `自动识别：${root}/responses ↔ ${root}/chat/completions`;
    };
    const clearTestStatus = () => { testStatus.textContent = ''; delete testStatus.dataset.state; };
    baseUrlInput.addEventListener('input', () => { baseUrlInput.removeAttribute('aria-invalid'); modelStatus.textContent = ''; clearTestStatus(); updateEndpointPreview(); });
    baseUrlInput.addEventListener('blur', () => {
      const normalized = normalizeEndpointInput(baseUrlInput.value);
      if (normalized && normalized !== baseUrlInput.value.trim()) {
        baseUrlInput.value = normalized;
        updateEndpointPreview();
      }
    });
    modelInput.addEventListener('input', () => { modelInput.removeAttribute('aria-invalid'); clearTestStatus(); });
    keyInput.addEventListener('input', () => { keyInput.removeAttribute('aria-invalid'); clearTestStatus(); });
    protocolSelect.addEventListener('change', () => { clearTestStatus(); updateEndpointPreview(); });
    updateEndpointPreview();
    const readForm = () => ({
      next: {
        provider: 'custom',
        protocol: protocolSelect.value,
        baseUrl: normalizeEndpointInput(baseUrlInput.value),
        model: modelInput.value.trim(),
        reasoning: reasoningSelect?.value || settings.reasoning || 'medium'
      },
      apiKey: keyInput.value.trim()
    });
    const canReuseKey = (baseUrl) => configured && baseUrl === configuredBaseUrl;
    const validateForm = ({ next, apiKey }, { requireModel = true, silent = false } = {}) => {
      const valid = validBaseUrl(next.baseUrl) && (!requireModel || Boolean(next.model)) && (Boolean(apiKey) || canReuseKey(next.baseUrl));
      if (!validBaseUrl(next.baseUrl)) baseUrlInput.setAttribute('aria-invalid', 'true');
      if (requireModel && !next.model) modelInput.setAttribute('aria-invalid', 'true');
      if (!apiKey && !canReuseKey(next.baseUrl)) keyInput.setAttribute('aria-invalid', 'true');
      if (!valid && !silent) onToast(requireModel ? '请填写有效的 API 端点、模型和密钥' : '请填写有效的 API 端点和密钥');
      return valid;
    };
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    fetchModelsButton.addEventListener('click', async () => {
      const formValue = readForm();
      if (!validateForm(formValue, { requireModel: false })) return;
      fetchModelsButton.disabled = true;
      fetchModelsButton.textContent = '读取中';
      modelStatus.textContent = '';
      const result = await window.desktopAPI?.listAIModels({ ...formValue.next, apiKey: formValue.apiKey });
      fetchModelsButton.disabled = false;
      fetchModelsButton.textContent = '获取模型';
      if (!result?.ok) {
        modelStatus.textContent = `读取失败：${result?.error || '未知错误'}`;
        onToast(`模型读取失败：${result?.error || '未知错误'}`);
        return;
      }
      modelOptions.replaceChildren(...result.models.map((model) => {
        const option = document.createElement('option');
        option.value = model;
        return option;
      }));
      if (!modelInput.value && result.models[0]) modelInput.value = result.models[0];
      modelStatus.textContent = `已从 ${result.endpoint} 读取 ${result.models.length} 个模型`;
      onToast(`已读取 ${result.models.length} 个可用模型`);
    });
    overlay.querySelector('[data-test]').addEventListener('click', async () => {
      const formValue = readForm();
      if (!validateForm(formValue, { silent: true })) {
        testStatus.textContent = '请先完善有效的 API 端点、模型和密钥。';
        testStatus.dataset.state = 'error';
        return;
      }
      const testButton = overlay.querySelector('[data-test]');
      testButton.disabled = true;
      testButton.textContent = '测试中...';
      testStatus.textContent = '正在测试连接，请稍候...';
      testStatus.dataset.state = 'pending';
      const configResult = await window.desktopAPI?.configureAI({ ...formValue.next, apiKey: formValue.apiKey });
      if (configResult?.ok) {
        configured = true;
        setApiIndicator(true);
        configuredBaseUrl = formValue.next.baseUrl;
        const testResult = await window.desktopAPI?.chatWithAI([{ role: 'user', content: '请只回复：连接成功' }]);
        if (testResult?.ok) {
          const protocolLabel = testResult.protocol === 'responses' ? 'Responses' : 'Chat Completions';
          testStatus.textContent = `连接成功 · ${protocolLabel} · ${testResult.endpoint || formValue.next.baseUrl}`;
          testStatus.dataset.state = 'success';
        } else {
          testStatus.textContent = `连接失败：${testResult?.error || '未知错误'}`;
          testStatus.dataset.state = 'error';
        }
      } else {
        testStatus.textContent = `配置失败：${configResult?.error || '未知错误'}`;
        testStatus.dataset.state = 'error';
      }
      testButton.disabled = false;
      testButton.textContent = '测试连接';
    });
    overlay.querySelector('[data-save]').addEventListener('click', async () => {
      const { next, apiKey } = readForm();
      if (!validateForm({ next, apiKey })) return;
      const saveButton = overlay.querySelector('[data-save]');
      saveButton.disabled = true;
      const result = await window.desktopAPI?.configureAI({ ...next, apiKey });
      saveButton.disabled = false;
      if (!result?.ok) { onToast(`API 配置失败：${result?.error || '未知错误'}`); return; }
      settings = next;
      configured = true;
      setApiIndicator(true);
      configuredBaseUrl = next.baseUrl;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      close();
      showChat();
      onToast(`${serviceLabel(settings.baseUrl)} API 已配置`);
    });
    overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
    requestAnimationFrame(() => baseUrlInput.focus());
  }

  async function openBrowserProvider(providerId) {
    const result = await window.desktopAPI?.openBrowserAI(providerId);
    const provider = BROWSER_PROVIDERS[providerId];
    if (!result?.ok) onToast(`无法打开 ${provider.label}：${result?.error || '未知错误'}`);
    else onToast(`${provider.label} 已在独立登录窗口中打开`);
    closeMenu();
  }

  function openMenu() {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'ai-mode-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `<div class="ai-menu-label">API 工作区</div><button class="ai-mode-option" type="button" data-ai-mode="api"><span class="ai-status-dot${configured ? ' configured' : ''}" aria-hidden="true"></span><span><strong>配置 API</strong><small>自动适配 OpenAI 兼容协议</small></span></button><button class="ai-mode-option" type="button" data-open-chat><span><strong>打开 API 对话</strong><small>${serviceLabel(settings.baseUrl)} · ${settings.model || '未设置模型'}</small></span></button><div class="ai-mode-divider"></div><div class="ai-menu-label">浏览器工作区</div><div class="ai-browser-grid">${Object.entries(BROWSER_PROVIDERS).map(([id, provider]) => `<div class="ai-browser-provider-row"><button type="button" data-browser-workspace="${id}">${provider.label}</button><button class="ai-browser-window-button" type="button" data-browser-provider="${id}" title="在独立窗口中打开 ${provider.label}" aria-label="在独立窗口中打开 ${provider.label}">${externalLinkIcon()}</button></div>`).join('')}</div>`;
    document.body.append(menu);
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(10, rect.left)}px`;
    menu.style.top = `${Math.max(10, rect.top - menu.offsetHeight - 8)}px`;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[data-ai-mode="api"]').addEventListener('click', openConfigModal);
    menu.querySelectorAll('[data-browser-workspace]').forEach((providerButton) => providerButton.addEventListener('click', () => showBrowserWorkspace(providerButton.dataset.browserWorkspace)));
    menu.querySelectorAll('[data-browser-provider]').forEach((providerButton) => providerButton.addEventListener('click', () => openBrowserProvider(providerButton.dataset.browserProvider)));
    menu.querySelector('[data-open-chat]').addEventListener('click', () => {
      closeMenu();
      if (!configured) { openConfigModal(); return; }
      showChat();
    });
  }

  button.addEventListener('click', () => (menu ? closeMenu() : openMenu()));
  document.addEventListener('project:selected', (event) => { activeProject = event.detail || null; renderMessages(); });
  closeButton.addEventListener('click', hideChat);
  clearChatButton.addEventListener('click', () => {
    messages.length = 0;
    persistMessages();
    renderMessages();
    input.focus();
    onToast('已开始新对话');
  });
  closeBrowserButton.addEventListener('click', hideBrowserWorkspace);
  restoreSidecarButton?.addEventListener('click', () => {
    if (activeBrowserProvider) window.desktopAPI?.openAISidecar(activeSidecarMode, activeBrowserProvider);
    else if (configured) showChat();
    else openMenu();
  });
  reloadBrowserButton.addEventListener('click', () => activeBrowserView?.reload());
  openBrowserWindowButton.addEventListener('click', () => openBrowserProvider(activeBrowserProvider));
  dockResizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dockResizer.setPointerCapture(event.pointerId);
    const resize = (moveEvent) => {
      setDockWidth(((window.innerWidth - moveEvent.clientX) / window.innerWidth) * 100);
    };
    const stop = () => {
      dockResizer.removeEventListener('pointermove', resize);
      dockResizer.removeEventListener('pointerup', stop);
      dockResizer.removeEventListener('pointercancel', stop);
    };
    dockResizer.addEventListener('pointermove', resize);
    dockResizer.addEventListener('pointerup', stop);
    dockResizer.addEventListener('pointercancel', stop);
  });
  dockResizer.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setDockWidth(dockWidth + (event.key === 'ArrowLeft' ? 2 : -2));
  });
  document.addEventListener('pointerdown', (event) => { if (menu && !event.target.closest('#aiModeButton') && !event.target.closest('.ai-mode-menu')) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  window.desktopAPI?.onAISidecarVisibility((visible) => { restoreSidecarButton.hidden = visible; });
  window.desktopAPI?.onAIHealth((healthy) => { configured = Boolean(healthy); setApiIndicator(healthy); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  sendButton.addEventListener('click', () => { if (sending && requestId) window.desktopAPI?.abortAI(requestId); });
  async function persistRuntimeChoice() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    const result = await window.desktopAPI?.configureAI({ ...settings, apiKey: '' });
    if (!result?.ok) onToast(`设置未生效：${result?.error || '未知错误'}`);
  }
  modelSelect.addEventListener('change', () => { settings.model = modelSelect.value; persistRuntimeChoice(); });
  reasoningSelect.addEventListener('change', () => { settings.reasoning = reasoningSelect.value; persistRuntimeChoice(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) { if (requestId) await window.desktopAPI?.abortAI(requestId); return; }
    const content = input.value.trim();
    if (!content) return;
    if (!configured) { openConfigModal(); return; }
    messages.push({ role: 'user', content });
    persistMessages();
    input.value = '';
    sending = true;
    sendButton.disabled = false;
    sendButton.textContent = '中断';
    sendButton.classList.add('danger-button');
    requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    renderMessages();
    const result = await window.desktopAPI?.chatWithAI(messages, requestId);
    if (result?.ok) { messages.push({ role: 'assistant', content: result.content }); persistMessages(); }
    else {
      const requestInfo = result?.requestId ? `（请求 ID：${result.requestId}）` : '';
      if (result?.error !== '请求已中断') onToast(`AI 请求失败：${result?.error || '未知错误'}${requestInfo}`);
      if (result?.error && /API|连接|模型/.test(result.error)) showBrowserWorkspace(activeBrowserProvider);
    }
    sending = false;
    sendButton.disabled = false;
    sendButton.textContent = '发送';
    sendButton.classList.remove('danger-button');
    requestId = '';
    renderMessages();
    input.focus();
  });
  setDockWidth(dockWidth);
  renderMessages();
}
