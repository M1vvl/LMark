const repository = (process.env.GITHUB_REPOSITORY || '').split('/');
// Defaults target the public LMark repository; CI can override them explicitly.
const owner = process.env.LMARK_GITHUB_OWNER || repository[0] || 'M1vvl';
const repo = process.env.LMARK_GITHUB_REPO || repository[1] || 'LMark';

module.exports = {
  appId: 'com.lmark.workspace',
  productName: 'LMark',
  artifactName: '${productName}-Portable-${version}-${arch}.${ext}',
  asar: true,
  asarUnpack: ['src/main/mcp-server.js'],
  files: ['src/**/*', 'package.json', 'README.md'],
  extraFiles: [
    { from: 'Global/StarMap/01_Web/dist', to: 'Global/StarMap/01_Web/dist' },
    { from: 'Global/TileMapSettings', to: 'Global/TileMapSettings' }
  ],
  directories: { output: 'release-publish' },
  win: { icon: 'build/lmark.ico', signExecutable: false, target: [{ target: 'dir', arch: ['x64'] }] },
  publish: owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'draft' }] : undefined
};
