const repository = (process.env.GITHUB_REPOSITORY || '').split('/');
// Defaults target the public LMark repository; CI can override them explicitly.
const owner = process.env.LMARK_GITHUB_OWNER || repository[0] || 'M1vvl';
const repo = process.env.LMARK_GITHUB_REPO || repository[1] || 'LMark';

module.exports = {
  appId: 'com.lmark.workspace',
  productName: 'LMark',
  artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  asar: true,
  asarUnpack: ['src/main/mcp-server.js'],
  files: ['src/**/*', 'package.json', 'README.md'],
  directories: { output: 'release-publish' },
  win: { icon: 'src/renderer/assets/lmark-logo.png', signAndEditExecutable: false, target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    differentialPackage: true
  },
  publish: owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'draft' }] : undefined
};
