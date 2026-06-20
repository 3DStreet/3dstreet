import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';

/**
 * Client transport for the Editor AI Assistant.
 *
 * Replaces the old direct Firebase AI Logic call (getGenerativeModel + startChat)
 * with a call to the `generateEditorChat` Cloud Function. The browser no longer
 * selects the model or talks to Vertex directly — see public/functions/
 * ai-chat-proxy.js for why (the 2026-06-19 image-model billing abuse).
 *
 * It mirrors the small slice of the Firebase AI Logic chat surface that
 * AIChatPanel actually used, so call sites only swap the constructor:
 *
 *   const chat = createProxyChat({ tools: [entityTools] });
 *   const result = await chat.sendMessage(prompt, { history, systemPrompt });
 *   result.response.text();            // string
 *   result.response.functionCalls();   // [{ name, args }]
 *   result.response.usageMetadata;     // { promptTokenCount, candidatesTokenCount }
 *
 * Tool *execution* is unchanged — it still happens in the browser against the
 * live A-Frame scene. This only proxies the model round-trip.
 */
export function createProxyChat({ tools } = {}) {
  const generateEditorChat = httpsCallable(functions, 'generateEditorChat');

  return {
    async sendMessage(message, { history = [], systemPrompt = '' } = {}) {
      const { data } = await generateEditorChat({
        message,
        history,
        systemInstruction: systemPrompt,
        tools
      });

      const text = data?.text || '';
      const functionCalls = Array.isArray(data?.functionCalls)
        ? data.functionCalls
        : [];
      const usageMetadata = data?.usageMetadata || {};

      // Adapt to the Firebase AI Logic response shape the panel expects.
      return {
        response: {
          text: () => text,
          functionCalls: () => functionCalls,
          usageMetadata
        }
      };
    }
  };
}
