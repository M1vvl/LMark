const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeConfiguration,
  requestCandidates,
  modelEndpoints,
  extractResponseText,
  extractSseText,
  extractModels,
  requestCompatibleAi
} = require('../src/main/ai/openai-compatible');

const configuration = normalizeConfiguration({
  provider: 'custom',
  protocol: 'auto',
  baseUrl: 'https://api.example.com',
  apiKey: 'test-key',
  model: 'chat-model'
});

test('unversioned custom hosts prefer the OpenAI v1 namespace', () => {
  assert.deepEqual(modelEndpoints(configuration), [
    'https://api.example.com/v1/models',
    'https://api.example.com/models'
  ]);
  assert.deepEqual(requestCandidates(configuration).slice(0, 2), [
    { protocol: 'chat-completions', endpoint: 'https://api.example.com/v1/chat/completions' },
    { protocol: 'chat-completions', endpoint: 'https://api.example.com/chat/completions' }
  ]);
});

test('full completion endpoints are normalized back to their API root', () => {
  const fullEndpoint = normalizeConfiguration({
    ...configuration,
    baseUrl: 'https://api.example.com/v1/chat/completions'
  });
  assert.deepEqual(modelEndpoints(fullEndpoint), ['https://api.example.com/v1/models']);
});

test('common Chat Completions and Responses payloads produce text', () => {
  assert.equal(extractResponseText({ choices: [{ message: { content: 'chat text' } }] }), 'chat text');
  assert.equal(extractResponseText({ output: [{ content: [{ type: 'output_text', text: 'response text' }] }] }), 'response text');
  assert.equal(extractResponseText({ choices: [{ text: 'legacy text' }] }), 'legacy text');
});

test('SSE chunks and model lists are parsed without inventing model names', () => {
  const sse = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n';
  assert.equal(extractSseText(sse), '你好');
  assert.deepEqual(extractModels({ data: [{ id: 'gpt-chat' }, { id: 'text-embedding-3-small' }, { id: 'gpt-chat' }] }), ['gpt-chat']);
});

test('gpt-5 compatible models prefer Responses and use the official request fields', async () => {
  const gptConfiguration = normalizeConfiguration({ ...configuration, model: 'gpt-5.6-sol' });
  const requests = [];
  const result = await requestCompatibleAi(async (endpoint, init) => {
    requests.push({ endpoint, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, gptConfiguration, [{ role: 'user', content: 'hello' }], { systemPrompt: 'system rule' });
  assert.equal(result.protocol, 'responses');
  assert.equal(requests[0].endpoint, 'https://api.example.com/v1/responses');
  assert.deepEqual(requests[0].body, {
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: 'hello' }],
    instructions: 'system rule',
    reasoning: { effort: 'medium' },
    store: false,
    stream: false
  });
});

test('auto mode falls back to Responses when Chat Completions returns HTTP 400', async () => {
  const attempts = [];
  const result = await requestCompatibleAi(async (endpoint) => {
    attempts.push(endpoint);
    if (endpoint.endsWith('/chat/completions')) return new Response(JSON.stringify({ error: { message: 'unsupported wire protocol' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ output_text: 'fallback ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, configuration, [{ role: 'user', content: 'hello' }]);
  assert.equal(result.protocol, 'responses');
  assert.equal(result.content, 'fallback ok');
  assert.ok(attempts.some((endpoint) => endpoint.endsWith('/responses')));
});
