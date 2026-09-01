const TOKEN_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)|(\$\$?)(.+?)\3|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|\*\*([^*]+)\*\*/g;

function text(value) { return document.createTextNode(value); }

async function appendTextTokens(parent, source, resolveImage) {
  let cursor = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    if (match.index > cursor) parent.append(text(source.slice(cursor, match.index)));
    if (match[1] !== undefined) {
      const figure = document.createElement('figure');
      figure.className = 'knowledge-image rich-image';
      figure.dataset.imagePath = match[2];
      figure.contentEditable = 'false';
      const image = document.createElement('img');
      image.alt = match[1] || '知识图片';
      const caption = document.createElement('figcaption');
      caption.textContent = match[1] || '';
      figure.append(image, caption);
      parent.append(figure);
      const result = await resolveImage?.(match[2]);
      if (result?.ok) image.src = result.dataUrl;
      else figure.classList.add('image-missing');
    } else if (match[7] !== undefined) {
      const strong = document.createElement('strong');
      await appendTextTokens(strong, match[7], resolveImage);
      parent.append(strong);
    } else {
      const formula = document.createElement('span');
      formula.className = match[3] === '$$' || match[5] !== undefined ? 'rich-formula display' : 'rich-formula';
      formula.dataset.latex = match[4] ?? match[5] ?? match[6] ?? '';
      formula.dataset.display = formula.classList.contains('display') ? 'true' : 'false';
      formula.contentEditable = 'false';
      formula.textContent = formula.dataset.latex;
      parent.append(formula);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) parent.append(text(source.slice(cursor)));
}

function cleanLegacySource(source) {
  return String(source).replace(/\\(?=<\/?(?:span|mark|strong|b|u)\b)/gi, '').replace(/\\(?=<\/)/g, '').replace(/\\\*\\\*/g, '**');
}

async function appendSafeNode(parent, node, resolveImage) {
  if (node.nodeType === Node.TEXT_NODE) { await appendTextTokens(parent, node.nodeValue, resolveImage); return; }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const tag = node.tagName.toLowerCase();
  const allowed = ['strong', 'b', 'u', 'span', 'mark'].includes(tag);
  const target = allowed ? document.createElement(tag === 'b' ? 'strong' : tag) : document.createDocumentFragment();
  if (tag === 'span') {
    const color = rgbToHex(node.style.color);
    const font = node.style.fontFamily.replace(/["']/g, '');
    const size = /^(?:[1-9]|[1-6][0-9])px$/.test(node.style.fontSize) ? node.style.fontSize : '';
    if (color) target.style.color = color;
    if (font && !/[;<>]/.test(font)) target.style.fontFamily = font;
    if (size) target.style.fontSize = size;
  } else if (tag === 'mark') {
    target.dataset.annotation = /^[\w-]+$/.test(node.dataset.annotation || '') ? node.dataset.annotation : 'highlight';
    target.style.backgroundColor = rgbToHex(node.style.backgroundColor) || '#ffe082';
  }
  for (const child of [...node.childNodes]) await appendSafeNode(target, child, resolveImage);
  parent.append(target);
}

export async function renderMarkdownInline(parent, source, resolveImage) {
  const normalized = cleanLegacySource(source);
  if (!/<\/?(?:span|mark|strong|b|u)\b/i.test(normalized)) {
    await appendTextTokens(parent, normalized, resolveImage);
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = normalized;
  for (const node of [...template.content.childNodes]) await appendSafeNode(parent, node, resolveImage);
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => { if (node.nodeValue.includes('**')) node.nodeValue = node.nodeValue.replaceAll('**', ''); });
}

function sanitizeStyle(element) {
  const styles = [];
  if (element.style.color) styles.push(`color:${rgbToHex(element.style.color) || element.style.color}`);
  if (element.style.fontFamily) styles.push(`font-family:${element.style.fontFamily.replace(/["']/g, '')}`);
  if (element.style.fontSize) styles.push(`font-size:${element.style.fontSize}`);
  return styles.join(';');
}

function rgbToHex(value) {
  const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return match ? `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}` : (/^#[0-9a-f]{6}$/i.test(value) ? value : '');
}

function inlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\u00a0/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.matches('br')) return '\n';
  if (node.matches('figure[data-image-path]')) {
    const caption = node.querySelector('figcaption')?.textContent || node.querySelector('img')?.alt || '';
    return `![${caption.replaceAll(']', '\\]')}](${node.dataset.imagePath})`;
  }
  if (node.matches('.rich-formula')) {
    const latex = node.dataset.latex || node.textContent || '';
    return node.dataset.display === 'true' ? `$$${latex}$$` : `$${latex}$`;
  }
  const content = [...node.childNodes].map(inlineMarkdown).join('');
  if (node.matches('strong,b')) return `<strong>${content}</strong>`;
  if (node.matches('u')) return `<u>${content}</u>`;
  if (node.matches('mark')) {
    const color = rgbToHex(node.style.backgroundColor) || '#ffe082';
    const annotation = node.dataset.annotation || 'highlight';
    return `<mark data-annotation="${annotation}" style="background-color:${color}">${content}</mark>`;
  }
  if (node.matches('span')) {
    const style = sanitizeStyle(node);
    return style ? `<span style="${style}">${content}</span>` : content;
  }
  return content;
}

export function richHtmlToMarkdown(root) {
  return [...root.children].map((block) => {
    const content = [...block.childNodes].map(inlineMarkdown).join('');
    if (/^H[1-6]$/.test(block.tagName)) return `${'#'.repeat(Number(block.tagName[1]))} ${content}`;
    if (block.matches('figure[data-image-path]')) return inlineMarkdown(block);
    return content;
  }).join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export async function markdownToRichHtml(root, markdown, resolveImage) {
  root.replaceChildren();
  const body = String(markdown).replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
  for (const blockSource of body ? body.split(/(?:\r?\n){2,}/) : ['']) {
    const heading = blockSource.match(/^(#{1,6})\s+([\s\S]+)$/);
    const block = document.createElement(heading ? `h${heading[1].length}` : 'p');
    await renderMarkdownInline(block, heading ? heading[2] : blockSource, resolveImage);
    if (!block.childNodes.length) block.append(document.createElement('br'));
    root.append(block);
  }
}

export function createRichEditor(root, options) {
  const onInput = typeof options === 'function' ? options : options?.onInput;
  const notifyInput = typeof onInput === 'function' ? onInput : () => {};
  let savedRange = null;
  let liveFormat = null;
  const currentSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    return root.contains(range.commonAncestorContainer) ? range : false;
  };
  const saveSelection = () => {
    const range = currentSelection();
    if (!range) return false;
    savedRange = range.cloneRange();
    return true;
  };
  const restoreSelection = () => {
    if (!savedRange || !root.contains(savedRange.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(savedRange);
    return true;
  };
  const unwrap = (element) => {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
  };
  const nearest = (node, selector) => {
    let item = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (item && item !== root) { if (item.matches?.(selector)) return item; item = item.parentElement; }
    return null;
  };
  const normalize = () => {
    root.querySelectorAll('strong strong, b strong, strong b, u u, mark mark').forEach(unwrap);
    const flattenNestedSpans = () => {
      let nestedSpan = [...root.querySelectorAll('span > span')]
        .find((span) => span.parentElement.childNodes.length === 1);
      while (nestedSpan) {
        const parent = nestedSpan.parentElement;
        ['color', 'fontFamily', 'fontSize'].forEach((property) => {
          if (!nestedSpan.style[property] && parent.style[property]) nestedSpan.style[property] = parent.style[property];
        });
        parent.before(nestedSpan);
        parent.remove();
        nestedSpan = [...root.querySelectorAll('span > span')]
          .find((span) => span.parentElement.childNodes.length === 1);
      }
    };
    flattenNestedSpans();
    root.querySelectorAll('mark > span:only-child').forEach((span) => {
      if (!span.style.fontSize && !span.style.fontFamily) return;
      const mark = span.parentElement;
      const parent = mark.parentNode;
      const next = mark.nextSibling;
      const contents = [...span.childNodes];
      span.remove();
      mark.replaceChildren(...contents);
      span.append(mark);
      parent.insertBefore(span, next);
    });
    flattenNestedSpans();
    const hasVisibleContent = (node) => /[^\s\u200b-\u200d\ufeff]/u.test(node.textContent || '')
      || Boolean(node.querySelector('img,figure,.rich-formula,br'));
    [...root.querySelectorAll('strong,b,u,mark,span')].reverse().forEach((node) => {
      if (node.dataset.formatBoundary) return;
      if (!hasVisibleContent(node)) {
        if (node.childNodes.length) unwrap(node);
        else node.remove();
      } else if (node.matches('span') && !sanitizeStyle(node)) unwrap(node);
    });
    const nodes = [...root.querySelectorAll('mark')];
    nodes.forEach((mark) => {
      const next = mark.nextSibling;
      if (next?.nodeType === Node.ELEMENT_NODE && next.matches('mark') && next.style.backgroundColor === mark.style.backgroundColor) {
        while (next.firstChild) mark.append(next.firstChild);
        next.remove();
      }
    });
  };
  const savedAncestor = (selector) => {
    if (!savedRange || !root.contains(savedRange.startContainer)) return null;
    const element = nearest(savedRange.startContainer, selector);
    return element && element.contains(savedRange.endContainer) ? element : null;
  };
  const rangeCovers = (range, element) => {
    const contents = document.createRange();
    contents.selectNodeContents(element);
    return range.compareBoundaryPoints(Range.START_TO_START, contents) <= 0
      && range.compareBoundaryPoints(Range.END_TO_END, contents) >= 0;
  };
  const selectedTextNodes = (range) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !/[^\s\u200b-\u200d\ufeff]/u.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const startsAfterNode = node === range.startContainer && range.startOffset >= node.length;
        const endsBeforeNode = node === range.endContainer && range.endOffset === 0;
        const overlaps = !startsAfterNode && !endsBeforeNode && range.intersectsNode(node);
        return overlaps ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  };
  const applyWrap = (tag, attributes = {}) => {
    if (!restoreSelection() && !saveSelection()) return false;
    const range = window.getSelection().getRangeAt(0);
    if (range.collapsed) return false;
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([name, value]) => name === 'style' ? element.setAttribute('style', value) : element.dataset[name] = value);
    const fragment = range.extractContents();
    if (tag === 'mark') fragment.querySelectorAll?.('mark').forEach(unwrap);
    element.append(fragment);
    range.insertNode(element);
    range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    savedRange = range.cloneRange();
    normalize();
    notifyInput();
    return true;
  };
  const toggleWrap = (kind, tag, selector) => {
    if (!restoreSelection() && !saveSelection()) return false;
    const range = window.getSelection().getRangeAt(0);
    const nodes = selectedTextNodes(range);
    if (!nodes.length) return false;
    const fullyActive = nodes.every((node) => Boolean(nearest(node, selector)));
    return clearSelectedFormat(kind, { wrapperFactory: fullyActive ? null : () => document.createElement(tag) });
  };
  const applyInlineStyle = (property, value) => {
    const kind = property === 'fontSize' ? 'size' : property === 'fontFamily' ? 'font' : 'color';
    return clearSelectedFormat(kind, { wrapperFactory: () => {
      const element = document.createElement('span');
      element.style[property] = value;
      return element;
    } });
  };
  const updateLiveFormat = (kind, value) => {
    if (!liveFormat || liveFormat.kind !== kind || !savedRange) return false;
    if (!liveFormat.element) {
      const candidate = savedAncestor(kind === 'color' ? 'span' : 'mark');
      const existing = candidate && rangeCovers(savedRange, candidate) ? candidate : null;
      if (existing) liveFormat.element = existing;
      else {
        const element = document.createElement(kind === 'color' ? 'span' : 'mark');
        if (kind === 'highlight') element.dataset.annotation = 'highlight';
        const fragment = savedRange.extractContents();
        if (kind === 'highlight') fragment.querySelectorAll?.('mark').forEach(unwrap);
        else fragment.querySelectorAll?.('span').forEach((span) => {
          span.style.color = '';
          if (!sanitizeStyle(span)) unwrap(span);
        });
        element.append(fragment);
        savedRange.insertNode(element);
        savedRange.selectNodeContents(element);
        liveFormat.element = element;
      }
    }
    if (kind === 'color') liveFormat.element.style.color = value;
    else liveFormat.element.style.backgroundColor = value;
    normalize();
    notifyInput();
    return true;
  };
  const splitParentAround = (marker, parent, preserveSelected) => {
    while (marker.parentNode !== parent) {
      const wrapper = marker.parentNode;
      const before = wrapper.cloneNode(false);
      const selected = wrapper.cloneNode(false);
      const after = wrapper.cloneNode(false);
      while (wrapper.firstChild && wrapper.firstChild !== marker) before.append(wrapper.firstChild);
      while (marker.nextSibling) after.append(marker.nextSibling);
      while (marker.firstChild) selected.append(marker.firstChild);
      marker.append(selected);
      if (before.childNodes.length) wrapper.before(before);
      wrapper.before(marker);
      if (after.childNodes.length) wrapper.before(after);
      wrapper.remove();
    }
    const before = parent.cloneNode(false);
    const after = parent.cloneNode(false);
    while (parent.firstChild && parent.firstChild !== marker) before.append(parent.firstChild);
    while (marker.nextSibling) after.append(marker.nextSibling);
    if (before.childNodes.length) parent.before(before);
    parent.before(marker);
    if (after.childNodes.length) parent.before(after);
    parent.remove();
    if (!preserveSelected) return;
  };
  const clearSelectedFormat = (kind, { notify = true, wrapperFactory = null } = {}) => {
    if (!restoreSelection() && !saveSelection()) return false;
    const range = window.getSelection().getRangeAt(0);
    if (range.collapsed) return false;
    const marker = document.createElement('span');
    marker.dataset.formatBoundary = kind;
    marker.append(range.extractContents());
    range.insertNode(marker);
    const styleProperty = kind === 'color' ? 'color' : kind === 'size' ? 'fontSize' : kind === 'font' ? 'fontFamily' : '';
    const wrapperSelector = kind === 'bold' ? 'strong,b' : kind === 'underline' ? 'u' : kind === 'highlight' ? 'mark' : '';
    const matches = (element) => styleProperty
      ? element.matches?.('span') && Boolean(element.style[styleProperty])
      : element.matches?.(wrapperSelector);
    let ancestor = marker.parentElement;
    while (ancestor && ancestor !== root) {
      if (matches(ancestor)) {
        splitParentAround(marker, ancestor, false);
        ancestor = marker.parentElement;
      } else ancestor = ancestor.parentElement;
    }
    if (styleProperty) {
      marker.querySelectorAll('span').forEach((span) => {
        span.style[styleProperty] = '';
        if (!sanitizeStyle(span)) unwrap(span);
      });
    } else marker.querySelectorAll(wrapperSelector).forEach(unwrap);
    const wrapper = wrapperFactory?.();
    if (wrapper) {
      while (marker.firstChild) wrapper.append(marker.firstChild);
      marker.append(wrapper);
    }
    normalize();
    const first = marker.firstChild;
    const last = marker.lastChild;
    unwrap(marker);
    const nextRange = document.createRange();
    if (wrapper?.isConnected) nextRange.selectNodeContents(wrapper);
    else if (first && last) { nextRange.setStartBefore(first); nextRange.setEndAfter(last); }
    else nextRange.selectNodeContents(root);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(nextRange);
    savedRange = nextRange.cloneRange();
    if (notify) notifyInput();
    return true;
  };
  root.addEventListener('input', notifyInput);
  root.addEventListener('pointerdown', () => { savedRange = null; });
  root.addEventListener('keyup', saveSelection);
  document.addEventListener('selectionchange', () => {
    const range = currentSelection();
    if (range) savedRange = range.cloneRange();
  });
  return {
    normalize,
    saveSelection,
    restoreSelection,
    selectedText() { return currentSelection() ? window.getSelection().toString().trim() : ''; },
    selectionRect() { const range = currentSelection(); return range ? range.getBoundingClientRect() : null; },
    formattingState() {
      const range = currentSelection() || savedRange;
      if (!range || !root.contains(range.startContainer)) return { font: '', size: '', color: '', highlight: '' };
      const styled = (property) => {
        let element = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
        while (element && element !== root) {
          if (element.style?.[property]) return element.style[property];
          element = element.parentElement;
        }
        return '';
      };
      const nodes = selectedTextNodes(range);
      const allWrapped = (selector) => nodes.length > 0 && nodes.every((node) => Boolean(nearest(node, selector)));
      return {
        font: styled('fontFamily').replace(/["']/g, ''),
        size: styled('fontSize'),
        color: rgbToHex(styled('color')),
        highlight: rgbToHex(styled('backgroundColor')),
        bold: allWrapped('strong,b'),
        underline: allWrapped('u')
      };
    },
    beginLiveFormat(kind, value) {
      if (!saveSelection() && !savedRange) return false;
      if (kind !== 'color' && kind !== 'highlight') return false;
      const candidate = savedAncestor(kind === 'color' ? 'span' : 'mark');
      liveFormat = { kind, element: candidate && rangeCovers(savedRange, candidate) ? candidate : null };
      return true;
    },
    updateLiveFormat,
    endLiveFormat() { liveFormat = null; },
    format(kind, value = '') {
      if (kind === 'bold') return toggleWrap('bold', 'strong', 'strong,b');
      if (kind === 'underline') return toggleWrap('underline', 'u', 'u');
      if (kind === 'font') return applyInlineStyle('fontFamily', value);
      if (kind === 'size') return applyInlineStyle('fontSize', value);
      if (kind === 'color') return value ? applyInlineStyle('color', value) : clearSelectedFormat('color');
      if (kind === 'highlight') {
        if (!restoreSelection() && !saveSelection()) return false;
        const range = window.getSelection().getRangeAt(0);
        const existing = nearest(range.startContainer, 'mark');
        if (existing && existing.contains(range.endContainer) && rangeCovers(range, existing)) {
          existing.style.backgroundColor = value; normalize(); notifyInput(); return true;
        }
        if (existing && existing.contains(range.endContainer)) clearSelectedFormat('highlight');
        return applyWrap('mark', { annotation: 'highlight', style: `background-color:${value}` });
      }
      if (kind === 'clearHighlight') {
        return clearSelectedFormat('highlight');
      }
      return false;
    },
    annotate(id, color) { return applyWrap('mark', { annotation: id, style: `background-color:${color}` }); },
    insertText(value) {
      root.focus();
      if (!restoreSelection()) {
        const range = document.createRange(); range.selectNodeContents(root); range.collapse(false); savedRange = range;
      }
      const range = savedRange;
      range.deleteContents(); range.insertNode(text(value)); range.collapse(false);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      savedRange = range.cloneRange(); notifyInput();
    },
    insertImage({ path, name, dataUrl }) {
      root.focus(); restoreSelection();
      const range = savedRange || (() => { const item = document.createRange(); item.selectNodeContents(root); item.collapse(false); return item; })();
      const figure = document.createElement('figure'); figure.className = 'knowledge-image rich-image'; figure.dataset.imagePath = path; figure.contentEditable = 'false';
      const image = document.createElement('img'); image.src = dataUrl || ''; image.alt = name || '';
      const caption = document.createElement('figcaption'); caption.textContent = name || '';
      figure.append(image, caption); range.insertNode(figure); range.setStartAfter(figure); range.collapse(true); savedRange = range.cloneRange(); notifyInput();
    }
  };
}
