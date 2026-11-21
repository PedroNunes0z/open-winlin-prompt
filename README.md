<p align="center">
  <img src="src/assets/img/logo.svg" alt="Open Winlin Prompt" width="140" height="140">
</p>

<h1 align="center">Open Winlin Prompt</h1>

<p align="center">
  Editor de prompts em Markdown com pré-visualização, biblioteca de APIs/IDEs/WebSites<br>
  e sugestões de escrita com IA <b>100% local</b> (Ollama + Qwen2.5-Coder 1.5B).
</p>

<p align="center">
  <a href="https://github.com/PedroNunes0z/open-winlin-prompt/releases/latest"><img src="https://img.shields.io/github/v/release/PedroNunes0z/open-winlin-prompt?style=flat-square&label=release" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-2ea44f?style=flat-square" alt="Licença MIT"></a>
  <img src="https://img.shields.io/badge/PRs-bem--vindos-00d2ff?style=flat-square" alt="PRs bem-vindos">
  <a href="#instalação"><img src="https://img.shields.io/badge/Instalar-Instalar.cmd-0969DA?style=flat-square" alt="Instalar"></a>
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square" alt="Windows">
  <img src="https://img.shields.io/badge/100%25%20local-offline-2ea44f?style=flat-square" alt="100% local">
  <img src="https://img.shields.io/badge/Ollama-local-6E56CF?style=flat-square" alt="Ollama">
  <img src="https://img.shields.io/badge/Qwen2.5--Coder-1.5B-8250DF?style=flat-square" alt="Qwen2.5-Coder">
  <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square" alt="Vite">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square" alt="Node.js">
</p>

---

## Sobre

O **Open Winlin Prompt** é um aplicativo de área de trabalho (web local) para criar, organizar e refinar prompts em Markdown — com formatação visível dentro do próprio editor, pré-visualização instantânea, biblioteca de referências (APIs, IDEs e WebSites) e sugestões de escrita geradas **no seu computador**, sem enviar nada para a internet.

## Open Source

Este projeto é **open source**, distribuído sob a [licença MIT](LICENSE) — você pode usar, estudar, modificar e redistribuir livremente, inclusive comercialmente, mantendo o aviso de copyright.

- **Código aberto:** todo o código-fonte está neste repositório, sem partes fechadas;
- **Sem telemetria:** nada sai do seu computador — a IA roda localmente pelo Ollama;
- **Sem dependências obrigatórias de serviço:** é um app estático (HTML/JS) gerado pelo Vite, que usa apenas o navegador;
- **Contribuições bem-vindas:** abra uma _issue_ para bugs e ideias, ou envie um _pull request_. Para mudanças maiores, descreva a proposta na issue antes de codar;
- **Releases automáticas:** cada tag `v*` é compilada pelo GitHub Actions e publicada em [Releases](https://github.com/PedroNunes0z/open-winlin-prompt/releases) já pronta para usar.

## Recursos

- **Editor Markdown rico** — negrito, itálico, títulos, código, listas, citações, tabelas e matemática (`$...$`, `$$...$$`) com destaque visual **dentro do editor**, sem perder o texto cru;
- **Pré-visualização instantânea** (GFM + realce de sintaxe + KaTeX), com botão de copiar código;
- **Sugestões inline de IA local** — texto fantasma com opacidade reduzida no cursor (`Tab` aceita, `Esc` ignora), com streaming, tamanho automático e tempo/falha na barra inferior;
- **Ações sobre a seleção** — ao selecionar um texto: **Reduzir**, **Aumentar** e **Corrigir gramática** com o modelo local;
- **Biblioteca do projeto** — cadastre **APIs** (provedor, URLs, chave e modelos), **IDEs** e **WebSites** e insira no prompt sem a chave;
- **Anexos com pré-visualização** — texto, imagem, PDF, áudio e vídeo (até 50 MB, guardados no IndexedDB);
- **Menções `@`** para referenciar prompts e anexos do projeto;
- **Desfazer/refazer** (`Ctrl+Z` / `Ctrl+Shift+Z`) e temas claro/escuro com cores de destaque.
- **Tema padrão ciano → azul** (`#00d2ff` → `#3a7bd5`) nos botões de destaque, selos, abas e detalhes, com superfícies branco-fantasma (`#f8f8ff`) no tema claro.

## Instalação

### Automática (recomendada)

1. Baixe o repositório (botão **Code → Download ZIP**) ou clone;
2. Duplo clique em **`Instalar.cmd`** — ele:
   - baixa o **pacote pronto** da Release e extrai em `%LOCALAPPDATA%\Programs\open-winlin-prompt` (substituindo, se existir) — em segundos e **sem precisar de Node.js ou Git**;
   - se o pacote não estiver disponível, cai para clonar o repositório e compilar (aí sim usando Git + Node);
   - configura o `OLLAMA_ORIGINS` automaticamente (o app abre já falando com o Ollama);
   - detecta o **Ollama** e, se faltar, instala;
   - baixa o modelo de IA, se você marcar;
   - cria o atalho na área de trabalho.

> Nada de administrador: tudo fica no seu perfil de usuário.

### Só o pacote pronto

Se preferir não usar o instalador, baixe direto o
[`open-winlin-prompt.zip`](https://github.com/PedroNunes0z/open-winlin-prompt/releases/latest/download/open-winlin-prompt.zip),
extraia onde quiser e execute **`Abrir Open Winlin Prompt.cmd`**.

### Manual (desenvolvimento)

Requer [Node.js](https://nodejs.org/) 18+ e [Git](https://git-scm.com/):

```bash
git clone https://github.com/PedroNunes0z/open-winlin-prompt.git
cd open-winlin-prompt
npm ci
npm run build
```

Depois abra a pasta `dist` e execute **`Abrir Open Winlin Prompt.cmd`** (ou abra o `dist/index.html` no navegador).

Para gerar uma release (o workflow compila e anexa o `.zip` automaticamente):

```bash
git tag -a v1.0.1 -m "Open Winlin Prompt 1.0.1"
git push origin v1.0.1
```

## Como usar

| Atalho | Ação |
| --- | --- |
| `Ctrl+N` | Novo prompt |
| `Ctrl+B` / `Ctrl+I` | Negrito / Itálico (alternam ao clicar de novo) |
| `Ctrl+K` | Buscar arquivos e biblioteca |
| `Ctrl+S` | Salvar workspace |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Desfazer / Refazer |
| `Ctrl+Espaço` | Pedir sugestão de IA na hora |
| `Tab` / `Esc` | Aceitar / Ignorar sugestão inline |
| `@` | Referenciar prompt ou anexo |

- Selecione um texto no editor para **Reduzir**, **Aumentar** ou **Corrigir gramática** com a IA local.

## IA local (Ollama)

As sugestões usam o [Ollama](https://ollama.com/download) com o modelo **Qwen2.5-Coder 1.5B** (`qwen2.5-coder:1.5b`, ≈ 986 MB), tudo offline:

1. Instale o Ollama — o instalador já cuida disso e configura o `OLLAMA_ORIGINS` automaticamente;
2. Se você usou o pacote pronto (zip) e o app não reconhecer o Ollama, execute **`Configurar Ollama.cmd`** — ele abre uma janela de progresso e resolve sozinho;
3. Nas **Configurações** (engrenagem), baixe o modelo e ligue as sugestões.

## Estrutura do projeto

```
open-winlin-prompt/
├── LICENSE                          # MIT
├── .github/workflows/release.yml    # compila e publica o .zip
├── Instalar.cmd / Instalar.ps1      # instalador (janela WPF)
├── Configurar Ollama.cmd            # liberação do Ollama p/ o app
├── Abrir Open Winlin Prompt.cmd     # atalho do programa
├── scripts/configurar-ollama.ps1    # script de configuração da IA
├── src/
│   ├── main.js                      # interface, biblioteca, IA, histórico
│   ├── editor.js                    # editor + formatação inline
│   ├── markdown.js                  # renderização GFM + KaTeX
│   ├── attachment-data.js           # anexos no IndexedDB
│   ├── store.js                     # workspace (localStorage)
│   ├── mentions.js                  # referências @
│   ├── icons.js                     # ícones Fluent
│   └── assets/img/logo.svg          # logo
└── dist/                            # build (gerado por npm run build)
```

## Licença

Distribuído sob a licença **MIT** — veja [LICENSE](LICENSE).

Feito por [Pedro Nunes](https://github.com/PedroNunes0z).

## Tecnologias

- [Vite](https://vite.dev/) + JavaScript
- [Fluent UI Web Components](https://www.fluentui.com/) (interface e ícones)
- [Marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/) (Markdown)
- [KaTeX](https://katex.org/) (matemática)
- [Ollama](https://ollama.com/) + Qwen2.5-Coder 1.5B (IA local)
