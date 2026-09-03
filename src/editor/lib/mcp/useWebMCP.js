/**
 * WebMCP registration hook (`document.modelContext`).
 *
 * The relay path (useMCPClient.js) makes this tab an MCP server for an
 * external client over a localhost WebSocket. WebMCP inverts the
 * transport: the page registers its tools directly with the *browser*,
 * and an agent driving that browser (Gemini in Chrome, ChatGPT's desktop
 * browser) calls them in-process. No relay, no pairing, no port — the
 * agent operates the user's own signed-in session, so registration is
 * automatic whenever the browser exposes the API.
 *
 * Registers the exact tool surface the relay serves (registry commands +
 * MCP read tools) through the shared executor in dispatch.js, so the two
 * transports stay behavior-identical, including the read-only gate.
 *
 * API status (Chrome origin trial, Chrome 149–156, or
 * chrome://flags/#enable-webmcp-testing): the getter moved from
 * `navigator.modelContext` to `document.modelContext` in Chrome 150 with
 * the old name kept as an alias. Registration is `registerTool` per tool
 * (the current explainer's API, lifetime scoped to an AbortSignal), with
 * bulk `provideContext({ tools })` kept as a fallback for older builds
 * that predate registerTool. On browsers without WebMCP the hook is a
 * no-op reporting `available: false`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { callToolAsMCPContent, listMCPTools } from './dispatch.js';

const MAX_TRANSCRIPT = 200;

const getModelContext = () => {
  if (typeof document !== 'undefined' && document.modelContext) {
    return document.modelContext;
  }
  if (typeof navigator !== 'undefined' && navigator.modelContext) {
    return navigator.modelContext;
  }
  return null;
};

export function useWebMCP({ currentUser, readOnly }) {
  const [status, setStatus] = useState(() =>
    getModelContext() ? 'registering' : 'unavailable'
  );
  const [toolCount, setToolCount] = useState(0);
  const [transcript, setTranscript] = useState([]);

  // Refs so execute closures see live values without re-registering the
  // tool set on every auth/read-only flip.
  const userRef = useRef(currentUser);
  const readOnlyRef = useRef(!!readOnly);
  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);
  useEffect(() => {
    readOnlyRef.current = !!readOnly;
  }, [readOnly]);

  const appendTranscript = useCallback((entry) => {
    setTranscript((prev) => {
      const next = prev.concat(entry);
      if (next.length <= MAX_TRANSCRIPT) return next;
      return next.slice(next.length - MAX_TRANSCRIPT);
    });
  }, []);

  const updateTranscript = useCallback((id, patch) => {
    setTranscript((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  }, []);

  useEffect(() => {
    const mc = getModelContext();
    if (!mc) return;

    let cancelled = false;
    // Current explainer scopes a registration's lifetime to an AbortSignal.
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    let usedProvideContext = false;

    // Every call funnels through the same executor the WS relay uses, and
    // lands in the panel transcript so the user watches the agent work.
    const makeExecute = (toolName) => async (args) => {
      // Mark this session as actively agent-driven. Mere presence of
      // `modelContext` doesn't mean an agent is here — the origin trial
      // gives every stock Chrome 149+ user the API — but a tool call does.
      // SignInModal reads this to show its agent-browser sign-in caveat
      // only where it applies.
      window.__webmcpAgentActive = true;
      const id = `webmcp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      appendTranscript({
        id,
        channel: 'webmcp',
        method: 'tools/call',
        name: toolName,
        args,
        status: 'pending',
        result: null,
        timestamp: new Date()
      });
      try {
        const content = await callToolAsMCPContent(toolName, args || {}, {
          currentUser: userRef.current,
          readOnly: readOnlyRef.current
        });
        updateTranscript(id, { status: 'success', result: content });
        return { content };
      } catch (err) {
        const message = err?.message || String(err);
        updateTranscript(id, { status: 'error', result: { message } });
        // MCP-style tool error: readable by the model, not a protocol fault.
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true
        };
      }
    };

    const tools = listMCPTools().map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      execute: makeExecute(def.name)
    }));

    (async () => {
      try {
        if (typeof mc.registerTool === 'function') {
          // Primary path per the current explainer: one registerTool per
          // tool, lifetime scoped to the AbortSignal. (Older builds ignore
          // the options bag; extra args are harmless.)
          for (const tool of tools) {
            await mc.registerTool(
              tool,
              controller ? { signal: controller.signal } : undefined
            );
          }
        } else if (typeof mc.provideContext === 'function') {
          // Legacy bulk surface from earlier Chrome builds.
          usedProvideContext = true;
          await mc.provideContext({ tools });
        } else {
          throw new Error(
            'modelContext exposes neither registerTool nor provideContext'
          );
        }
        if (!cancelled) {
          setToolCount(tools.length);
          setStatus('registered');
        }
      } catch (err) {
        console.warn('[webmcp] tool registration failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (controller) controller.abort();
        if (usedProvideContext) mc.provideContext({ tools: [] });
      } catch (err) {
        console.warn('[webmcp] cleanup failed:', err);
      }
    };
  }, [appendTranscript, updateTranscript]);

  return {
    available: status !== 'unavailable',
    status,
    toolCount,
    transcript
  };
}
