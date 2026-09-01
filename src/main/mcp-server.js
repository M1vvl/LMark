#!/usr/bin/env node
/* Minimal stdio MCP server for an LMark project root. */
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? args[rootArg + 1] || process.env.CODEX_MCP_ROOT || '.' : process.env.CODEX_MCP_ROOT || '.');
const MAX_FILE_BYTES = 5_000_000;

function inside(relative) {
  const target = path.resolve(root, relative || '');
  if (target !== root && !target.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw new Error('path must stay inside the configured project root');
  return target;
}
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return {};
  const result = {};
  for (const line of raw.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
}
function titleOf(raw, filePath) {
  const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return title || path.basename(filePath, path.extname(filePath));
}
async function markdownFiles(folder = root) {
  const result = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)) result.push(full);
      if (result.length >= 1000) return;
    }
  }
  await walk(folder);
  return result;
}
async function readNote(notePath) {
  const absolute = inside(notePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('note is not a readable text file');
  const content = await fs.readFile(absolute, 'utf8');
  return { path: path.relative(root, absolute).replaceAll('\\', '/'), title: titleOf(content, absolute), frontmatter: parseFrontmatter(content), content, mtimeMs: stat.mtimeMs };
}
async function searchNotes(query, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const file of await markdownFiles()) {
    const raw = await fs.readFile(file, 'utf8');
    const title = titleOf(raw, file);
    const index = `${title}\n${raw}`.toLowerCase().indexOf(q);
    if (index < 0) continue;
    results.push({ path: path.relative(root, file).replaceAll('\\', '/'), title, snippet: raw.slice(Math.max(0, index - 80), index + 220).replace(/\s+/g, ' ') });
    if (results.length >= Math.min(100, Math.max(1, Number(limit) || 20))) break;
  }
  return results;
}
async function writeAtomic(file, content) {
  const temp = `${file}.codex-mcp-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}
async function callTool(name, input = {}) {
  if (name === 'search_notes') return searchNotes(input.query, input.limit);
  if (name === 'get_note') return readNote(input.path);
  if (name === 'get_vault_context') {
    const files = await markdownFiles();
    return { root, noteCount: files.length, recentNotes: await Promise.all(files.slice(-20).map((file) => readNote(path.relative(root, file)))) };
  }
  if (name === 'create_note') {
    const target = inside(input.path);
    if (!/\.(md|markdown|txt)$/i.test(target)) throw new Error('new notes must use .md, .markdown or .txt');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(input.content || `# ${path.basename(target, path.extname(target))}\n`), { encoding: 'utf8', flag: 'wx' });
    return readNote(path.relative(root, target));
  }
  if (name === 'update_note') {
    const target = inside(input.path);
    const stat = await fs.stat(target);
    if (input.expectedMtime != null && Math.abs(Number(input.expectedMtime) - stat.mtimeMs) > 1) throw new Error('note changed since it was read; re-read before updating');
    await writeAtomic(target, String(input.content || ''));
    return readNote(path.relative(root, target));
  }
  if (name === 'append_to_note') {
    const target = inside(input.path);
    const current = await fs.readFile(target, 'utf8');
    await writeAtomic(target, `${current}${current.endsWith('\n') ? '' : '\n'}${String(input.content || '')}\n`);
    return readNote(path.relative(root, target));
  }
  throw new Error(`unknown tool: ${name}`);
}
const tools = [
  { name: 'search_notes', description: 'Search local Markdown/text notes by title or content.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'get_note', description: 'Read one local note with title, frontmatter, content and mtime.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'get_vault_context', description: 'Inspect the configured project root and recent notes.', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_note', description: 'Create a new note without overwriting an existing file.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path'] } },
  { name: 'update_note', description: 'Atomically update a note with optional expectedMtime conflict protection.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, expectedMtime: { type: 'number' } }, required: ['path', 'content'] } },
  { name: 'append_to_note', description: 'Append Markdown to an existing note.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } }
];
function result(id, value, error = false) { return JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error: { code: -32000, message: String(value) } } : { result: value }) }); }
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { process.stdout.write(result(null, 'invalid JSON', true) + '\n'); return; }
  if (request.method === 'notifications/initialized') return;
  try {
    if (request.method === 'initialize') process.stdout.write(result(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codex-workspace-mcp', version: '0.1.0' } }) + '\n');
    else if (request.method === 'tools/list') process.stdout.write(result(request.id, { tools }) + '\n');
    else if (request.method === 'tools/call') process.stdout.write(result(request.id, { content: [{ type: 'text', text: JSON.stringify(await callTool(request.params?.name, request.params?.arguments || {})) }] }) + '\n');
    else process.stdout.write(result(request.id, `method not found: ${request.method}`, true) + '\n');
  } catch (error) { process.stdout.write(result(request.id, error.message, true) + '\n'); }
});
