const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const included = ['src', 'package.json', 'README.md', 'build', 'scripts/release', '.github'];
const forbiddenNames = new Set(['settings.json', 'auth.json']);
const forbiddenContent = [
  /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
  /[A-Z]:\\Users\\(?!Public\\)[^\\\r\n]+/gi,
  /[A-Z]:\\Table\\Codex\\软件\\自定义学习\\CodexDesktopShell\\Mission/gi
];
const errors = [];
function scan(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      if (['node_modules', 'release', 'release-publish', 'tmp', '.git'].includes(name)) continue;
      scan(path.join(target, name));
    }
    return;
  }
  if (forbiddenNames.has(path.basename(target).toLowerCase())) errors.push(`禁止打包用户配置：${path.relative(root, target)}`);
  if (stat.size > 2_000_000) return;
  const content = fs.readFileSync(target, 'utf8');
  for (const pattern of forbiddenContent) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) errors.push(`发现隐私或密钥模式：${path.relative(root, target)} (${pattern})`);
  }
}
included.forEach((item) => scan(path.join(root, item)));
if (fs.existsSync(path.join(root, 'Mission'))) console.log('Mission 目录存在，但不在 electron-builder files 白名单中。');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('隐私审计通过：发布白名单中未发现 API 密钥、用户配置或个人绝对路径。');
