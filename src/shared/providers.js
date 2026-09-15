// 内置免费模型平台：AI Tools (https://platform.aitools.cfd/)
const BUILTIN_PROVIDER_ID = 'aitools';

const BUILTIN_PROVIDER = {
  id: BUILTIN_PROVIDER_ID,
  name: 'AI Tools（免费内置）',
  baseURL: 'https://platform.aitools.cfd/api/v1',
  apiKey: 'sk-841f22a282d44aa58d45c6d25cbbcbb3',
  builtIn: true,
  models: [
    { id: 'zhipu/glm-4v-flash', name: 'GLM-4V-Flash（视觉 · 推荐）', vision: true },
    { id: 'zhipu/glm-4.1v-thinking-flash', name: 'GLM-4.1V-Thinking（视觉推理）', vision: true },
    { id: 'zhipu/glm-4.6v-flash', name: 'GLM-4.6V-Flash（视觉）', vision: true },
    { id: 'google/gemma-4-31b', name: 'Gemma-4-31B（多模态）', vision: true },
    { id: 'zhipu/glm-4.7-flash', name: 'GLM-4.7-Flash（文本）', vision: false },
    { id: 'zhipu/glm-4-flash', name: 'GLM-4-Flash（文本）', vision: false },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS-20B（文本推理）', vision: false },
  ],
};

module.exports = { BUILTIN_PROVIDER_ID, BUILTIN_PROVIDER };
