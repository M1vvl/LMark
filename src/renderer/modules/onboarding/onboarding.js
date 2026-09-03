const COMPLETED_KEY = 'lmark.onboarding.completed.v1';
const GLOBAL_COMPLETED_KEY = 'lmark.global-onboarding.completed.v1';

const STEPS = [
  {
    target: '#projectList',
    title: '创建文件或项目',
    body: '在工作区左侧项目列表的空白处点击右键，即可创建文件或项目。',
  },
  {
    target: '#projectList .tree-item',
    title: '删除项目',
    body: '对已创建的项目点击右键，选择删除即可移除项目。',
  },
  {
    target: '#projectSectionLabel',
    title: '创建附属笔记',
    body: '将鼠标移到项目栏，点击出现的加号，可以创建附属笔记项目。',
  },
  {
    target: '#settingsButton',
    title: '设置默认文件位置',
    body: '打开设置后，在项目与文件位置中修改默认保存目录。',
  },
  {
    target: '#aiModeButton',
    title: '启用 AI',
    body: '打开“启用 AI”，配置 API 后即可使用右侧 AI 对话。',
  },
  {
    target: '#themeButton',
    title: '主题设置',
    body: '点击顶部主题按钮，选择软件主题和自定义壁纸。',
  },
  {
    target: '#workspaceModeButton',
    title: '切换工作区',
    body: '通过工作区按钮切换工作区、休闲区和环球区。',
  },
];

const GLOBAL_STEPS = [
  {
    target: '#globalMapSettingsButton',
    title: '切换高清地图',
    body: '环球区默认使用本地低清地图。打开右上角“瓦片地图设置”，点击“教程帮助”申请并填写 Cesium ion Token，即可切换高清地图。',
  },
  {
    target: '#globalStarmapFrame::#globalCountryEditorPanel',
    title: '添加抵达国家',
    body: '在 StarMap 左侧“本地编辑”中添加你到访的国家。国家记录只保存在当前用户本地。',
  },
  {
    target: '#globalStarmapFrame::#globalCityAddButton',
    title: '添加城市',
    body: '点击已添加的国家，在右侧城市卡片中点击“添加城市”，搜索并确认城市后即可定位到地图。',
  },
  {
    target: '#globalStarmapFrame::#globalCityPhotoSection',
    title: '管理城市照片与时间',
    body: '对福州等已添加城市点击右键，可选择“添加照片”或“编辑抵达与离开时间”。照片仅写入你的本地数据。',
  },
];

let remoteRect;
let lastRemoteSelector;
const targetForStep = (step) => {
  if (!step.target.includes('::')) return document.querySelector(step.target) || document.querySelector('.workspace-panel');
  const [frameSelector, selector] = step.target.split('::');
  const frame = document.querySelector(frameSelector);
  if (frame?.contentWindow && lastRemoteSelector !== selector) {
    lastRemoteSelector = selector;
    remoteRect = undefined;
    frame.contentWindow.postMessage({ type: 'lmark-onboarding-target', selector }, '*');
  }
  if (remoteRect) return { getBoundingClientRect: () => remoteRect };
  return frame || document.querySelector('.workspace-panel');
};

export function createOnboardingController() {
  let overlay;
  let current = 0;
  let activeSteps = STEPS;
  let activeKey = COMPLETED_KEY;
  const receiveRemoteTarget = (event) => {
    if (!event.data || event.data.type !== 'lmark-onboarding-target') return;
    const frame = document.querySelector('#globalStarmapFrame');
    const frameRect = frame?.getBoundingClientRect();
    if (!frameRect || !event.data.rect) return;
    const rect = event.data.rect;
    remoteRect = { left: frameRect.left + rect.left, top: frameRect.top + rect.top, right: frameRect.left + rect.right, bottom: frameRect.top + rect.bottom, width: rect.width, height: rect.height };
    render();
  };

  const close = (completed) => {
    if (completed) localStorage.setItem(activeKey, 'true');
    window.removeEventListener('resize', render);
    window.removeEventListener('message', receiveRemoteTarget);
    overlay?.remove();
    overlay = undefined;
    remoteRect = undefined;
    lastRemoteSelector = undefined;
  };

  const render = () => {
    if (!overlay) return;
    const step = activeSteps[current];
    const target = targetForStep(step);
    const rect = target?.getBoundingClientRect();
    const spotlight = overlay.querySelector('[data-onboarding-spotlight]');
    if (spotlight && rect) {
      spotlight.style.left = `${Math.max(6, rect.left - 7)}px`;
      spotlight.style.top = `${Math.max(6, rect.top - 7)}px`;
      spotlight.style.width = `${Math.min(window.innerWidth - 12, rect.width + 14)}px`;
      spotlight.style.height = `${Math.min(window.innerHeight - 12, rect.height + 14)}px`;
    }
    const title = overlay.querySelector('[data-onboarding-title]');
    const body = overlay.querySelector('[data-onboarding-body]');
    const progress = overlay.querySelector('[data-onboarding-progress]');
    const next = overlay.querySelector('[data-onboarding-next]');
    if (title) title.textContent = step.title;
    if (body) body.textContent = step.body;
    if (progress) progress.textContent = `${current + 1} / ${activeSteps.length}`;
    if (next) next.textContent = current === activeSteps.length - 1 ? '完成' : '下一步';
    const dialog = overlay.querySelector('[data-onboarding-dialog]');
    if (dialog && rect) {
      const dialogWidth = Math.min(360, window.innerWidth - 32);
      const below = rect.bottom + 18;
      const top = below + 180 <= window.innerHeight ? below : Math.max(16, rect.top - 198);
      dialog.style.width = `${dialogWidth}px`;
      dialog.style.left = `${Math.min(window.innerWidth - dialogWidth - 16, Math.max(16, rect.left))}px`;
      dialog.style.top = `${top}px`;
    }
  };

  const open = ({ force = false, mode } = {}) => {
    const global = mode === 'global' || (mode === undefined && document.body.dataset.workspaceMode === 'global');
    activeSteps = global ? GLOBAL_STEPS : STEPS;
    activeKey = global ? GLOBAL_COMPLETED_KEY : COMPLETED_KEY;
    if (!force && localStorage.getItem(activeKey) === 'true') return;
    close(false);
    current = 0;
    overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="onboarding-shade" aria-hidden="true"></div>
      <div class="onboarding-spotlight" data-onboarding-spotlight aria-hidden="true"></div>
      <section class="onboarding-dialog" data-onboarding-dialog>
        <div class="onboarding-dialog-meta"><span data-onboarding-progress></span><button type="button" data-onboarding-skip>跳过</button></div>
        <h2 data-onboarding-title></h2><p data-onboarding-body></p>
        <div class="onboarding-actions"><button type="button" class="onboarding-next" data-onboarding-next>下一步</button></div>
      </section>`;
    document.body.append(overlay);
    overlay.querySelector('[data-onboarding-skip]').addEventListener('click', () => close(true));
    overlay.querySelector('[data-onboarding-next]').addEventListener('click', () => {
      if (current >= activeSteps.length - 1) close(true);
      else { current += 1; render(); }
    });
    window.addEventListener('resize', render);
    window.addEventListener('message', receiveRemoteTarget);
    requestAnimationFrame(render);
  };

  return {
    open,
    openFromHelp: () => open({ force: true }),
    maybeOpen: () => open(),
    maybeOpenGlobal: () => open({ mode: 'global' }),
    close: () => { window.removeEventListener('resize', render); close(false); },
  };
}
