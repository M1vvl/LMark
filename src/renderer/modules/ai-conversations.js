const STORAGE_KEY = 'codex-ai-conversations-v2';
const LEGACY_KEY = 'codex-ai-conversation-v1';

function id() {
  return globalThis.crypto?.randomUUID?.() || `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function titleFrom(messages, fallback = '新对话') {
  const first = messages.find((message) => message?.role === 'user' && typeof message.content === 'string')?.content?.trim();
  if (!first) return fallback;
  return first.replace(/\s+/g, ' ').slice(0, 34) || fallback;
}

function normalizeConversation(value) {
  const messages = Array.isArray(value?.messages)
    ? value.messages.filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string').slice(-200)
    : [];
  const createdAt = Number(value?.createdAt) || Date.now();
  return {
    id: typeof value?.id === 'string' && value.id ? value.id : id(),
    title: typeof value?.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 80) : titleFrom(messages),
    messages,
    createdAt,
    updatedAt: Number(value?.updatedAt) || createdAt,
    parentId: typeof value?.parentId === 'string' ? value.parentId : ''
  };
}

function load(storage) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(stored) && stored.length) return stored.map(normalizeConversation);
    const legacy = JSON.parse(storage.getItem(LEGACY_KEY) || '[]');
    if (Array.isArray(legacy) && legacy.length) return [normalizeConversation({ messages: legacy })];
  } catch { /* Corrupt history is replaced with a clean conversation. */ }
  return [normalizeConversation({})];
}

export function createConversationStore(storage = localStorage) {
  let conversations = load(storage);
  const persist = () => storage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(-100)));
  persist();

  const api = {
    list() { return [...conversations].sort((left, right) => right.updatedAt - left.updatedAt); },
    get(conversationId) { return conversations.find((conversation) => conversation.id === conversationId) || null; },
    current() { return api.list()[0]; },
    create(title = '新对话') {
      const now = Date.now();
      const conversation = normalizeConversation({ id: id(), title, createdAt: now, updatedAt: now, messages: [] });
      conversations.push(conversation);
      persist();
      return conversation;
    },
    updateMessages(conversationId, messages) {
      const conversation = api.get(conversationId);
      if (!conversation) return null;
      conversation.messages = messages.filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string').slice(-200);
      conversation.title = titleFrom(conversation.messages, conversation.title);
      conversation.updatedAt = Date.now();
      persist();
      return conversation;
    },
    fork(conversationId) {
      const source = api.get(conversationId);
      if (!source) return null;
      const now = Date.now();
      const branch = normalizeConversation({
        id: id(),
        title: `${source.title} · 分支`,
        messages: source.messages.map((message) => ({ ...message })),
        createdAt: now,
        updatedAt: now,
        parentId: source.id
      });
      conversations.push(branch);
      persist();
      return branch;
    },
    remove(conversationId) {
      if (conversations.length <= 1) return false;
      const before = conversations.length;
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      if (conversations.length === before) return false;
      persist();
      return true;
    }
  };
  return Object.freeze(api);
}
