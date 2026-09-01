const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHtml, withoutFrontmatter } = require('../src/main/notes/pdf-export');

test('PDF export removes YAML front matter but keeps Markdown content', async () => {
  const markdown = '---\ntitle: "Example"\nannotations:\n---\n\n# Example\n\n**Body**';
  assert.equal(withoutFrontmatter(markdown).trimStart(), '# Example\n\n**Body**');
  const html = await buildHtml(process.cwd(), markdown, 'Example');
  assert.doesNotMatch(html, /annotations:/);
  assert.match(html, /<h1>Example<\/h1>/);
  assert.match(html, /<strong>Body<\/strong>/);
});

test('PDF export removes script elements from note content', async () => {
  const html = await buildHtml(process.cwd(), '# Safe\n<script>alert(1)</script>\nText', 'Safe');
  assert.doesNotMatch(html, /alert\(1\)/);
  assert.match(html, /Text/);
});
