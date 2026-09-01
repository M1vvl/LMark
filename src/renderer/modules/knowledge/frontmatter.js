const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

function quote(value) {
  return JSON.stringify(String(value ?? ''));
}

function unquote(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try { return JSON.parse(source); }
  catch { return source.replace(/^['"]|['"]$/g, ''); }
}

export function splitFrontmatter(content = '') {
  const match = String(content).match(FRONTMATTER_PATTERN);
  if (!match) return { metadata: {}, body: String(content), hasFrontmatter: false };
  const metadata = { annotations: [] };
  let annotation = null;
  for (const line of match[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (top) {
      annotation = null;
      if (top[1] !== 'annotations') metadata[top[1]] = unquote(top[2]);
      continue;
    }
    const item = line.match(/^\s{2}-\s+([A-Za-z][\w-]*):\s*(.*)$/);
    if (item) {
      annotation = { [item[1]]: unquote(item[2]) };
      metadata.annotations.push(annotation);
      continue;
    }
    const property = line.match(/^\s{4}([A-Za-z][\w-]*):\s*(.*)$/);
    if (property && annotation) annotation[property[1]] = unquote(property[2]);
  }
  return { metadata, body: String(content).slice(match[0].length), hasFrontmatter: true };
}

export function serializeFrontmatter(metadata = {}, body = '') {
  const lines = ['---'];
  for (const key of ['title', 'created', 'updated', 'documentNote']) {
    if (metadata[key] !== undefined && metadata[key] !== '') lines.push(`${key}: ${quote(metadata[key])}`);
  }
  lines.push('annotations:');
  for (const item of Array.isArray(metadata.annotations) ? metadata.annotations : []) {
    lines.push(`  - id: ${quote(item.id)}`);
    for (const key of ['quote', 'note', 'color', 'created']) lines.push(`    ${key}: ${quote(item[key])}`);
  }
  lines.push('---', '', String(body).replace(/^\s+/, ''));
  return `${lines.join('\n').trimEnd()}\n`;
}

export function normalizeNote(content, fallbackTitle = '未命名知识') {
  const parsed = splitFrontmatter(content);
  const now = new Date().toISOString();
  const heading = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return serializeFrontmatter({
    ...parsed.metadata,
    title: parsed.metadata.title || heading || fallbackTitle,
    created: parsed.metadata.created || now,
    updated: now,
    annotations: parsed.metadata.annotations || []
  }, parsed.body || `# ${fallbackTitle}\n\n`);
}

export function updateNote(content, changes = {}) {
  const parsed = splitFrontmatter(content);
  return serializeFrontmatter({ ...parsed.metadata, ...changes, updated: new Date().toISOString(), annotations: changes.annotations || parsed.metadata.annotations || [] }, parsed.body);
}

export function noteTitle(content, fallback = '') {
  const parsed = splitFrontmatter(content);
  return parsed.metadata.title || parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}
