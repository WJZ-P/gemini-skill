import { writeFileSync } from 'node:fs';

const trace = { actions: [], attachments: [], generation: null };

export function createAtlasProvider() {
  return {};
}

export async function createGeminiSession() {
  return {
    ops: {
      async checkLogin() {
        return { ok: true, loggedIn: true };
      },
      async click(key) {
        if (key !== 'newChatBtn') throw new Error(`Unexpected click: ${key}`);
        trace.actions.push('newChat');
        // Starting a new chat clears the current draft's uploaded reference images.
        trace.attachments = [];
        return { ok: true };
      },
      async ensureModelPro() {
        trace.actions.push('modelPro');
        return { ok: true };
      },
      async uploadImage(filePath) {
        trace.actions.push(`upload:${filePath}`);
        if (filePath === 'missing.png') return { ok: false, error: 'file_not_found' };
        trace.attachments.push(filePath);
        return { ok: true };
      },
      async generateImage(prompt, options) {
        trace.actions.push('generate');
        trace.generation = { prompt, options, attachments: [...trace.attachments] };
        return { ok: true, filePath: 'generated.png' };
      },
    },
  };
}

export function disconnect() {
  trace.actions.push('disconnect');
  writeFileSync(process.env.GEMINI_TEST_TRACE_PATH, JSON.stringify(trace));
}
