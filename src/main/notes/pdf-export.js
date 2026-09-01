const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function withoutFrontmatter(content) {
  return String(content).replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
}

async function inlineImage(root, relativePath) {
  const target = path.resolve(root, relativePath.replaceAll('/', path.sep));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return '';
  const extension = path.extname(target).toLowerCase();
  const mime = extension === '.png' ? 'image/png' : extension === '.gif' ? 'image/gif' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  try { return `data:${mime};base64,${(await fs.promises.readFile(target)).toString('base64')}`; }
  catch { return ''; }
}

async function markdownBody(root, content) {
  const source = withoutFrontmatter(content).replace(/<script[\s\S]*?<\/script>/gi, '');
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = new Map();
  for (const match of source.matchAll(imagePattern)) images.set(match[0], { dataUrl: await inlineImage(root, match[2]), caption: match[1] || '' });
  return source.split(/\r?\n/).map((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) return `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`;
    if (!line.trim()) return '<div class="space"></div>';
    let html = escapeHtml(line);
    for (const [markdown, image] of images) {
      html = html.replace(escapeHtml(markdown), image.dataUrl ? `<figure><img src="${image.dataUrl}" alt="${escapeHtml(image.caption)}"><figcaption>${escapeHtml(image.caption)}</figcaption></figure>` : '<p class="missing">图片无法读取</p>');
    }
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>')
      .replace(/&lt;mark(?:\s+.*?)?&gt;([\s\S]*?)&lt;\/mark&gt;/g, '<mark>$1</mark>')
      .replace(/&lt;span style=&quot;((?:color|font-family|font-size):[^&]+)&quot;&gt;([\s\S]*?)&lt;\/span&gt;/g, '<span style="$1">$2</span>');
    return `<p>${html}</p>`;
  }).join('\n');
}

async function buildHtml(root, content, title) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:18mm 17mm 20mm}*{box-sizing:border-box}body{margin:0;color:#17191d;background:#fff;font:11pt/1.75 "Microsoft YaHei","Segoe UI",sans-serif;overflow-wrap:anywhere}h1{font-size:25pt;margin:0 0 16mm}h2{font-size:18pt;margin:9mm 0 3mm}h3{font-size:14pt;margin:7mm 0 2mm}h4,h5,h6{font-size:12pt;margin:5mm 0 2mm}p{margin:0 0 3.2mm;white-space:pre-wrap}.space{height:2.5mm}figure{break-inside:avoid;margin:6mm 0;text-align:center}img{max-width:100%;max-height:210mm;object-fit:contain}figcaption{margin-top:2mm;color:#69707a;font-size:9pt}mark{padding:0 .1em;background:#ffe082}code{font-family:Consolas,monospace}.missing{padding:4mm;border:1px dashed #c44;color:#a22}
  </style><title>${escapeHtml(title)}</title></head><body>${await markdownBody(root, content)}</body></html>`;
}

async function exportKnowledgePdf({ ownerWindow, root, sourcePath, content, title, outputPath }) {
  const { BrowserWindow, dialog } = require('electron');
  let target = outputPath;
  if (!target) {
    const suggested = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`);
    const result = await dialog.showSaveDialog(ownerWindow, { title: '导出笔记为 PDF', defaultPath: suggested, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }
  const renderWindow = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { offscreen: true, sandbox: false } });
  try {
    const html = await buildHtml(root, content, title);
    await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const bytes = await renderWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } });
    await fs.promises.writeFile(target, bytes);
    return { canceled: false, path: target, name: path.basename(target) };
  } finally {
    if (!renderWindow.isDestroyed()) renderWindow.destroy();
  }
}

module.exports = { exportKnowledgePdf, buildHtml, withoutFrontmatter };
