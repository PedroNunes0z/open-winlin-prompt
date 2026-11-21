// Persistência local do workspace. Tudo fica no navegador, sem servidor.

const STORAGE_KEY = 'open-winlin-prompt.workspace.v1';
const LEGACY_STORAGE_KEY = 'prompt-studio.workspace.v1';

export const uid = (prefix = 'id') =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))}`;

const now = () => new Date().toISOString();

function seedWorkspace() {
  const projectId = uid('proj');
  const attachmentId = uid('att');
  const promptId1 = uid('doc');
  const promptId2 = uid('doc');

  return {
    version: 1,
    theme: 'dark',
    accent: 'cyan',
    ai: { enabled: false, when: 'pause', size: 'auto', model: 'qwen2.5-coder:1.5b' },
    activeProjectId: projectId,
    activePromptId: promptId1,
    openTabs: [promptId1, promptId2],
    projects: [
      {
        id: projectId,
        name: 'Meu primeiro projeto',
        createdAt: now(),
        prompts: [
          {
            id: promptId1,
            name: 'Guia de markdown.md',
            createdAt: now(),
            updatedAt: now(),
            content: `# Guia rápido de Markdown\n\nEste é o **Open Winlin Prompt**. Escreva à esquerda e veja o resultado formatado aqui à direita, em tempo real. As formatações também aparecem em destaque no próprio editor.\n\n## Recursos\n\n- [x] Pré-visualização instantânea\n- [x] Realce de sintaxe em blocos de código\n- [x] Tabelas, listas e citações\n- [ ] Experimente digitar \`@\` no editor\n\n### Tabela\n\n| Comando | Atalho | Ação |\n| --- | --- | --- |\n| Novo prompt | \`Ctrl+N\` | Cria arquivo markdown |\n| Salvar | \`Ctrl+S\` | Grava no navegador |\n| Buscar | \`Ctrl+K\` | Foca a busca |\n| Negrito | \`Ctrl+B\` | Envolve em ** \\*\\* |\n\n### Código com destaque\n\n\`\`\`js\nfunction saudacao(nome) {\n  const mensagem = \`Olá, \${nome}!\`;\n  console.log(mensagem);\n  return mensagem;\n}\n\nsaudacao('mundo');\n\`\`\`\n\n\`\`\`python\ndef fib(n: int) -> int:\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\`\`\`\n\n> **Dica:** use \`@\` para referenciar qualquer prompt ou anexo do projeto.\n\n---\n\nFórmula inline: $E = mc^2$. Bloco matemático:\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n`,
          },
          {
            id: promptId2,
            name: 'Prompt com referência.md',
            createdAt: now(),
            updatedAt: now(),
            content: `# Análise de contexto\n\nLeia o arquivo @contexto.txt e responda às perguntas abaixo.\n\n1. Quais são os pontos principais?\n2. Que recomendações você faria?\n\n## Instruções\n\n- Seja objetivo e use tópicos.\n- Cite trechos do anexo quando relevante.\n- \`\`\`json\n  { "formato": "markdown", "idioma": "pt-BR" }\n  \`\`\`\n`,
          },
        ],
        attachments: [
          {
            id: attachmentId,
            name: 'contexto.txt',
            type: 'text/plain',
            size: 92,
            binary: false,
            content:
              'Contexto de exemplo: o projeto busca reunir prompts reutilizáveis, com anexos e referências, em um único espaço de trabalho rápido e organizado.',
            createdAt: now(),
          },
        ],
        apis: [
          {
            id: uid('api'),
            provider: 'Exemplo de API',
            siteUrl: 'https://exemplo.com',
            baseUrl: 'https://api.exemplo.com/v1',
            apiKey: '',
            modelIds: 'modelo-exemplo',
            createdAt: now(),
          },
        ],
        ides: [
          {
            id: uid('ide'),
            name: 'Exemplo de IDE',
            siteUrl: 'https://exemplo.com/ide',
            description: 'Exemplo: edite ou exclua este item para organizar suas IDEs.',
            createdAt: now(),
          },
        ],
        websites: [
          {
            id: uid('web'),
            name: 'Exemplo de site',
            siteUrl: 'https://exemplo.com',
            description: 'Exemplo: organize aqui os sites que você usa com frequência.',
            createdAt: now(),
          },
        ],
      },
    ],
  };
}

function normalize(raw) {
  if (!raw || !Array.isArray(raw.projects) || raw.projects.length === 0) return seedWorkspace();
  raw.version = 1;
  raw.theme = raw.theme === 'light' ? 'light' : 'dark';
  raw.accent = raw.accent || 'cyan';
  raw.ai = {
    enabled: Boolean(raw.ai?.enabled),
    when: ['pause', 'typing', 'manual'].includes(raw.ai?.when) ? raw.ai.when : 'pause',
    size: ['auto', 'short', 'medium', 'long'].includes(raw.ai?.size) ? raw.ai.size : 'auto',
    model: raw.ai?.model || 'qwen2.5-coder:1.5b',
  };
  for (const p of raw.projects) {
    p.prompts ||= [];
    p.attachments ||= [];
    p.apis ||= [];
    p.ides ||= [];
    p.websites ||= [];
    p.createdAt ||= now();
    p.name ||= 'Projeto sem nome';
  }
  if (!raw.projects.some((p) => p.id === raw.activeProjectId)) {
    raw.activeProjectId = raw.projects[0].id;
  }
  return raw;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : seedWorkspace();
  } catch (err) {
    console.warn('Não foi possível carregar o workspace:', err);
    return seedWorkspace();
  }
}

export const state = load();

let persistTimer = null;
let onSaved = () => {};

export function setSavedHandler(fn) {
  onSaved = fn;
}

export function persist({ immediate = false } = {}) {
  clearTimeout(persistTimer);
  const write = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      onSaved(true);
    } catch (err) {
      console.error('Falha ao salvar:', err);
      onSaved(false, err);
    }
  };
  if (immediate) write();
  else persistTimer = setTimeout(write, 350);
}

export function getActiveProject() {
  return state.projects.find((p) => p.id === state.activeProjectId) || state.projects[0];
}

export function getPrompt(project, id) {
  return project?.prompts.find((p) => p.id === id);
}

export function getAttachment(project, id) {
  return project?.attachments.find((a) => a.id === id);
}

export function findPromptById(id) {
  for (const project of state.projects) {
    const prompt = getPrompt(project, id);
    if (prompt) return { project, prompt };
  }
  return null;
}

export function usageBytes() {
  try {
    return new Blob([JSON.stringify(state)]).size;
  } catch {
    return 0;
  }
}

export function exportWorkspace() {
  return JSON.stringify(state, null, 2);
}

export function importWorkspace(json) {
  const parsed = normalize(JSON.parse(json));
  state.ai = parsed.ai;
  state.projects = parsed.projects;
  state.activeProjectId = parsed.activeProjectId;
  state.activePromptId = parsed.activePromptId;
  state.openTabs = parsed.openTabs || [];
  persist({ immediate: true });
}

export function resetWorkspace() {
  const fresh = seedWorkspace();
  state.projects = fresh.projects;
  state.activeProjectId = fresh.activeProjectId;
  state.activePromptId = fresh.activePromptId;
  state.openTabs = fresh.openTabs;
  persist({ immediate: true });
}
