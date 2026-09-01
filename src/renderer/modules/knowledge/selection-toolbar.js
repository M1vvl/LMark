export function createSelectionToolbar({ onFormat, onBeginLive, onUpdateLive, onEndLive, onAnnotate, onAsk }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'knowledge-selection-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = `
    <select data-format="font" title="字体" aria-label="字体"><option value="">字体</option><option value="Microsoft YaHei">微软雅黑</option><option value="SimSun">宋体</option><option value="Consolas">Consolas</option></select>
    <select data-format="size" title="字号" aria-label="字号"><option value="">字号</option><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option><option value="18px">18</option><option value="22px">22</option><option value="28px">28</option><option value="36px">36</option></select>
    <button type="button" data-format="bold" title="加粗"><strong>B</strong></button>
    <button type="button" data-format="underline" title="下划线"><u>U</u></button>
    <label title="文字颜色"><input type="color" data-format="color" value="#73a7ff" /></label>
    <label title="标记颜色"><input type="color" data-format="highlight" value="#ffe082" /></label>
    <button type="button" data-action="annotate" title="添加备注">备注</button>
    <button type="button" data-action="ask" title="询问 AI">AI</button>`;
  document.body.append(toolbar);

  toolbar.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
    if (event.target.matches('input[type="color"]')) {
      delete event.target.dataset.lastApplied;
      onBeginLive(event.target.dataset.format, event.target.value, event.target);
    }
  });
  toolbar.addEventListener('click', (event) => {
    const format = event.target.closest('[data-format]')?.dataset.format;
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (format === 'bold' || format === 'underline') onFormat(format, '');
    if (action === 'annotate') onAnnotate();
    if (action === 'ask') onAsk();
  });
  const applyControl = (event) => {
    const format = event.target.dataset.format;
    if (!format || !event.target.value || event.target.dataset.lastApplied === event.target.value) return;
    event.target.dataset.lastApplied = event.target.value;
    if (event.target.matches('input[type="color"]')) onUpdateLive(format, event.target.value, event.target);
    else onFormat(format, event.target.value);
  };
  toolbar.addEventListener('input', (event) => {
    if (event.target.matches('input[type="color"]')) applyControl(event);
  });
  toolbar.addEventListener('change', (event) => {
    applyControl(event);
    if (event.target.matches('input[type="color"]')) onEndLive();
    if (event.target.tagName === 'SELECT') event.target.value = '';
  });

  return {
    show(rect, state = {}) {
      toolbar.hidden = false;
      const font = toolbar.querySelector('[data-format="font"]');
      const size = toolbar.querySelector('[data-format="size"]');
      font.value = [...font.options].some((option) => option.value === state.font) ? state.font : '';
      size.value = [...size.options].some((option) => option.value === state.size) ? state.size : '';
      if (state.color) toolbar.querySelector('[data-format="color"]').value = state.color;
      if (state.highlight) toolbar.querySelector('[data-format="highlight"]').value = state.highlight;
      ['bold', 'underline'].forEach((format) => toolbar.querySelector(`[data-format="${format}"]`).setAttribute('aria-pressed', String(Boolean(state[format]))));
      const width = toolbar.offsetWidth;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
      const preferredTop = rect.top - toolbar.offsetHeight - 9;
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${preferredTop > 42 ? preferredTop : rect.bottom + 9}px`;
    },
    hide() { toolbar.hidden = true; },
    setColor(format, value, source = null) {
      const input = toolbar.querySelector(`[data-format="${format}"]`);
      if (input && input !== source && value) input.value = value;
    },
    element: toolbar
  };
}
