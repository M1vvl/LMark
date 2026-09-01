const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  chooseCloseAction: (choice) => ipcRenderer.invoke('window:close-choice', choice),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window:confirm-close', listener);
    return () => ipcRenderer.removeListener('window:confirm-close', listener);
  },
  openFile: () => ipcRenderer.invoke('file:open'),
  getDroppedFilePath: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch { return ''; }
  },
  previewPdf: (filePath) => ipcRenderer.invoke('file:preview-pdf', filePath),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  getProjectRoot: () => ipcRenderer.invoke('settings:get-project-root'),
  setProjectRoot: (folderPath) => ipcRenderer.invoke('settings:set-project-root', folderPath),
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('update:set-channel', channel),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (callback) => {
    const events = ['checking', 'available', 'none', 'progress', 'downloaded', 'error'];
    const listeners = events.map((name) => {
      const listener = (_event, payload) => callback(name, payload);
      ipcRenderer.on(`update:${name}`, listener);
      return [name, listener];
    });
    return () => listeners.forEach(([name, listener]) => ipcRenderer.removeListener(`update:${name}`, listener));
  },
  getMcpCommand: () => ipcRenderer.invoke('mcp:get-command'),
  listManagedProjects: () => ipcRenderer.invoke('projects:list-managed'),
  createManagedProject: (name, workspacePath) => ipcRenderer.invoke('projects:create-managed', { name, workspacePath }),
  listManagedWorkspaces: () => ipcRenderer.invoke('workspaces:list-managed'),
  createManagedWorkspace: (workspace) => ipcRenderer.invoke('workspaces:create', workspace),
  ensureManagedWorkspace: (workspace) => ipcRenderer.invoke('workspaces:ensure', workspace),
  openManagedFolder: (folderPath) => ipcRenderer.invoke('workspaces:open-folder', folderPath),
  trashWorkspace: (folderPath) => ipcRenderer.invoke('workspaces:trash', folderPath),
  onManagedWorkspacesChanged: (callback) => {
    const listener = (_event, workspaces) => callback(workspaces);
    ipcRenderer.on('workspaces:changed', listener);
    return () => ipcRenderer.removeListener('workspaces:changed', listener);
  },
  onManagedProjectsChanged: (callback) => {
    const listener = (_event, projects) => callback(projects);
    ipcRenderer.on('projects:changed', listener);
    return () => ipcRenderer.removeListener('projects:changed', listener);
  },
  openProjectInExplorer: (folderPath) => ipcRenderer.invoke('project:open-in-explorer', folderPath),
  listKnowledgeFiles: (folderPath) => ipcRenderer.invoke('project:list-knowledge', folderPath),
  readKnowledgeFile: (folderPath, relativePath) => ipcRenderer.invoke('project:read-knowledge', folderPath, relativePath),
  writeKnowledgeFile: (folderPath, fileName, content) => ipcRenderer.invoke('project:write-knowledge', folderPath, fileName, content),
  createKnowledgeFile: (folderPath, fileName) => ipcRenderer.invoke('project:create-knowledge', folderPath, fileName),
  saveKnowledgeFile: (folderPath, relativePath, content) => ipcRenderer.invoke('project:save-knowledge', folderPath, relativePath, content),
  setKnowledgeContext: (context) => ipcRenderer.invoke('knowledge:set-context', context),
  getKnowledgeContext: () => ipcRenderer.invoke('knowledge:get-context'),
  saveAIKnowledge: (request) => ipcRenderer.invoke('ai:save-knowledge', request),
  onAIKnowledgeSaved: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('knowledge:ai-saved', listener);
    return () => ipcRenderer.removeListener('knowledge:ai-saved', listener);
  },
  renameKnowledgeFile: (folderPath, relativePath, nextName) => ipcRenderer.invoke('project:rename-knowledge', folderPath, relativePath, nextName),
  revealKnowledgeFile: (folderPath, relativePath) => ipcRenderer.invoke('project:reveal-knowledge', folderPath, relativePath),
  trashKnowledgeFile: (folderPath, relativePath) => ipcRenderer.invoke('project:trash-knowledge', folderPath, relativePath),
  saveKnowledgeImage: (folderPath, image) => ipcRenderer.invoke('project:save-knowledge-image', folderPath, image),
  chooseKnowledgeImage: (folderPath) => ipcRenderer.invoke('project:choose-knowledge-image', folderPath),
  readKnowledgeImage: (folderPath, relativePath) => ipcRenderer.invoke('project:read-knowledge-image', folderPath, relativePath),
  readKnowledgeNotes: (folderPath, relativePath) => ipcRenderer.invoke('project:read-knowledge-notes', folderPath, relativePath),
  saveKnowledgeNotes: (folderPath, relativePath, content) => ipcRenderer.invoke('project:save-knowledge-notes', folderPath, relativePath, content),
  exportKnowledgePdf: (folderPath, relativePath) => ipcRenderer.invoke('project:export-knowledge-pdf', folderPath, relativePath),
  renameProject: (folderPath, nextName) => ipcRenderer.invoke('project:rename', folderPath, nextName),
  trashProject: (folderPath) => ipcRenderer.invoke('project:trash', folderPath),
  trashProjects: (folderPaths) => ipcRenderer.invoke('projects:trash-many', folderPaths),
  configureAI: (configuration) => ipcRenderer.invoke('ai:configure', configuration),
  getAIStatus: () => ipcRenderer.invoke('ai:get-status'),
  setAIHealth: (healthy) => ipcRenderer.invoke('ai:set-health', healthy),
  onAIHealth: (callback) => {
    const listener = (_event, healthy) => callback(Boolean(healthy));
    ipcRenderer.on('ai:health', listener);
    return () => ipcRenderer.removeListener('ai:health', listener);
  },
  listAIModels: (configuration) => ipcRenderer.invoke('ai:list-models', configuration),
  chatWithAI: (messages, requestId) => ipcRenderer.invoke('ai:chat', { messages, requestId }),
  abortAI: (requestId) => ipcRenderer.invoke('ai:abort', requestId),
  explainWithAI: (selectedText, context) => ipcRenderer.invoke('ai:explain', { selectedText, context }),
  openBrowserAI: (provider) => ipcRenderer.invoke('ai:open-browser', provider),
  openAISidecar: (mode, provider, prefill, autoSend = false) => ipcRenderer.invoke('ai:open-sidecar', { mode, provider, prefill, autoSend }),
  hideAISidecar: () => ipcRenderer.invoke('ai:hide-sidecar'),
  onAISidecarMode: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('ai:sidecar-set-mode', listener);
    return () => ipcRenderer.removeListener('ai:sidecar-set-mode', listener);
  },
  onAISidecarVisibility: (callback) => {
    const listener = (_event, visible) => callback(Boolean(visible));
    ipcRenderer.on('ai:sidecar-visibility', listener);
    return () => ipcRenderer.removeListener('ai:sidecar-visibility', listener);
  },
  chooseWallpaper: () => ipcRenderer.invoke('wallpaper:choose')
  ,getCurrentWallpaper: () => ipcRenderer.invoke('wallpaper:get-current')
  ,resolveWallpaperUrl: (value) => ipcRenderer.invoke('wallpaper:resolve-url', value)
  ,chooseWallpaperProject: () => ipcRenderer.invoke('wallpaper:choose-project')
  ,openMathType: (formula) => ipcRenderer.invoke('mathtype:open', formula)
  ,chooseDocumentForAnalysis: () => ipcRenderer.invoke('document:choose-analysis')
}));
