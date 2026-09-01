const version = require('../../package.json').version;
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
const configuredOwner = process.env.LMARK_GITHUB_OWNER || owner || 'M1vvl';
const configuredRepo = process.env.LMARK_GITHUB_REPO || repo || 'LMark';
if (!configuredOwner || !configuredRepo) {
  console.error('缺少 GitHub 仓库信息。请设置 GITHUB_REPOSITORY=owner/repo，或 LMARK_GITHUB_OWNER 与 LMARK_GITHUB_REPO。');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)) {
  console.error(`版本号 ${version} 不符合稳定版 x.y.z 或测试版 x.y.z-beta.n 规范。`);
  process.exit(1);
}
console.log(`准备发布 LMark ${version}。`);
