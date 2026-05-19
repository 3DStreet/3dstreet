import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Tooltip } from 'radix-ui';
import { ai } from '@shared/services/firebase';
import { getGenerativeModel } from 'firebase/ai';
import {
  Copy32Icon,
  DownloadIcon,
  ChatbotIcon,
  ArrowUp24Icon
} from '@shared/icons';
import { useAuthContext } from '../../contexts';
import useStore from '@/store';
import styles from './AIChatPanel.module.scss';
import posthog from 'posthog-js';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';
import { systemPrompt } from './AIChatPrompt.js';
import AIChatTools, { entityTools } from './AIChatTools.jsx';
import { AwesomeIcon } from '../../components/elements/AwesomeIcon';
import {
  faRotate,
  faThumbsUp,
  faThumbsDown,
  faRotateLeft,
  faRotateRight,
  faPlug,
  faLock,
  faLockOpen
} from '@fortawesome/free-solid-svg-icons';
import { getGroupedMixinOptions } from '../../lib/mixinUtils';
import Events from '../../lib/Events';
import { useMCPClient } from '../../lib/mcp/useMCPClient.js';

const AI_MODEL_ID = 'gemini-3-flash-preview';
let AI_CONVERSATION_ID = uuidv4();

// Cap pill list growth so a multi-hour session doesn't accumulate thousands
// of DOM nodes. Drag updates are coalesced by History.execute(), so this only
// trims after many *distinct* edits.
const MAX_PILLS = 500;

const PillTooltip = ({ children, content }) => (
  <Tooltip.Root delayDuration={0}>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side="bottom"
        align="center"
        sideOffset={6}
        collisionPadding={8}
        className={styles.pillTooltipContent}
      >
        {content}
        <Tooltip.Arrow className={styles.pillTooltipArrow} />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

const HELP_EXAMPLES = [
  'Make a basic street with 2 drive lanes, 2 sidewalks, and 2 bike lanes',
  'Add a row of pedestrians to the sidewalk',
  'Replace the trees with palm trees',
  'Take 3 snapshots from different angles',
  'Set the location to 37.7749, -122.4194',
  'Rename the scene to "Market Street redesign"'
];

const HELP_COMMANDS = [
  {
    command: '/mcp',
    description:
      'Connect Claude Desktop or Claude Code over the MCP relay (alpha)'
  }
];

const MCP_HELP_MARKDOWN = `**MCP integration** (alpha)

Drive this scene from Claude Desktop or Claude Code. The status bar above will turn green once the relay pairs.

**Claude Code:**

\`\`\`
claude mcp add 3dstreet -- npx -y 3dstreet-mcp
\`\`\`

**Claude Desktop:** add this to \`claude_desktop_config.json\` and restart:

\`\`\`json
{
  "mcpServers": {
    "3dstreet": { "command": "npx", "args": ["-y", "3dstreet-mcp"] }
  }
}
\`\`\`

Then click **Reconnect** above. Once paired, the relay forwards Claude's tool calls to this tab. Toggle **Read-only** to block scene mutations. Source and docs: [github.com/3DStreet/3dstreet-mcp](https://github.com/3DStreet/3dstreet-mcp).`;

const MCP_PAIR_SUCCESS_MARKDOWN =
  '**MCP relay paired.** Tool calls from your MCP client are now wired through this tab. Return to **Claude** (or whichever MCP client you launched the relay from) to continue your workflow. Keep this tab open in the background.';

// Helper component for the copy button
const CopyButton = ({ jsonData, textContent }) => {
  const [copied, setCopied] = useState(false);

  const convertMarkdownToHtml = (markdown) => {
    // Basic markdown to HTML conversion for common patterns
    let html = markdown
      // Convert headers
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      // Convert bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Convert italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Convert code blocks
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // Convert inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Convert unordered lists
      .replace(/^\* (.*)$/gm, '<li>$1</li>')
      // Convert ordered lists
      .replace(/^\d+\. (.*)$/gm, '<li>$1</li>')
      // Convert links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Convert line breaks (preserve paragraphs)
      .replace(/\n\s*\n/g, '</p><p>')
      // Convert single line breaks
      .replace(/\n/g, '<br>');

    // Wrap content in paragraph tags if not already wrapped
    if (!html.startsWith('<h') && !html.startsWith('<p>')) {
      html = '<p>' + html + '</p>';
    }

    return html;
  };

  const handleCopy = async () => {
    try {
      if (jsonData) {
        await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      } else if (textContent) {
        // Create a temporary element to hold the HTML content
        const tempElement = document.createElement('div');
        tempElement.innerHTML = convertMarkdownToHtml(textContent);

        // Use the Clipboard API to write both text and HTML formats
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([textContent], { type: 'text/plain' }),
            'text/html': new Blob([tempElement.innerHTML], {
              type: 'text/html'
            })
          })
        ]);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback to plain text if the clipboard API fails
      try {
        if (textContent) {
          await navigator.clipboard.writeText(textContent);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      } catch (fallbackErr) {
        console.error('Fallback copy also failed:', fallbackErr);
      }
    }
  };

  return (
    <button onClick={handleCopy} className={styles.copyButton}>
      <Copy32Icon />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
};

// Function call message component
const FunctionCallMessage = ({ functionCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { name, args, status, result } = functionCall;
  const setModal = useStore((state) => state.setModal);

  return (
    <div
      className={`${styles.chatMessage} ${styles.functionCall} ${styles[status]}`}
    >
      <div
        className={styles.functionCallSummary}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={`${styles.statusIndicator} ${styles[status]}`}></span>
        <strong>{name}</strong>:{' '}
        {status === 'pending'
          ? 'Executing...'
          : status === 'success'
            ? 'Completed'
            : 'Failed'}
        {name === 'setLatLon' && status === 'success' && (
          <button
            className={styles.editLocationButton}
            onClick={(e) => {
              e.stopPropagation(); // Prevent expanding the function call details
              setModal('geo');
              posthog.capture('openGeoModalFromAIChat');
            }}
          >
            Edit Precise Location
          </button>
        )}
      </div>

      {isExpanded && (
        <div className={styles.functionCallDetails}>
          <div>
            <strong>Function:</strong> {name}
          </div>
          <div>
            <strong>Arguments:</strong>
          </div>
          <pre>{JSON.stringify(args, null, 2)}</pre>
          {status !== 'pending' && (
            <>
              <div>
                <strong>Result:</strong>
              </div>
              <pre>
                {typeof result === 'object'
                  ? JSON.stringify(result, null, 2)
                  : result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Snapshot message component
const SnapshotMessage = ({ snapshot }) => {
  const { caption, imageData } = snapshot;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // Create a temporary image element to load the image data
      const img = new Image();
      img.crossOrigin = 'anonymous';

      // Set up a promise to wait for the image to load
      const imageLoaded = new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
      });

      // Set the source and wait for it to load
      img.src = imageData;
      await imageLoaded;

      // Create a canvas and draw the image on it
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Convert the canvas to a blob
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );

      // Use the clipboard API to write the blob as an image
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);

      // Show success notification
      STREET.notify.successMessage('Image copied to clipboard');

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy image data:', err);
      // Show error notification
      STREET.notify.errorMessage('Failed to copy image to clipboard');
    }
  };

  const handleDownload = () => {
    // Create a temporary anchor element to trigger download
    const link = document.createElement('a');
    link.href = imageData;
    link.download = `${caption || 'snapshot'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Show success notification
    STREET.notify.successMessage('Image download started');
  };

  return (
    <div
      className={`${styles.chatMessage} ${styles.snapshot} ${styles.snapshotContainer}`}
    >
      <div className={styles.snapshotCaption}>{caption}</div>
      <div className={styles.snapshotImageWrapper}>
        <img src={imageData} className={styles.snapshotImage} alt={caption} />
        <div className={styles.snapshotActions}>
          <button
            onClick={handleCopy}
            className={styles.snapshotButton}
            title={copied ? 'Copied!' : 'Copy image'}
          >
            <Copy32Icon />
          </button>
          <button
            onClick={handleDownload}
            className={styles.snapshotButton}
            title="Download image"
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
    </div>
  );
};

// Inline transcript entry for an incoming MCP frame. Mirrors
// FunctionCallMessage so users can recognize "the LLM is calling a tool"
// regardless of whether it came from the in-editor Gemini path or from
// Claude over the MCP relay.
const MCPFrameMessage = ({ frame }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { method, name, args, status, result } = frame;
  const label = name || method;

  return (
    <div
      className={`${styles.chatMessage} ${styles.functionCall} ${styles[status]}`}
    >
      <div
        className={styles.functionCallSummary}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={`${styles.statusIndicator} ${styles[status]}`}></span>
        <strong>mcp · {label}</strong>:{' '}
        {status === 'pending'
          ? 'Executing…'
          : status === 'success'
            ? 'Completed'
            : 'Failed'}
      </div>

      {isExpanded && (
        <div className={styles.functionCallDetails}>
          <div>
            <strong>Method:</strong> {method}
          </div>
          {name && (
            <div>
              <strong>Tool:</strong> {name}
            </div>
          )}
          {args && (
            <>
              <div>
                <strong>Arguments:</strong>
              </div>
              <pre>{JSON.stringify(args, null, 2)}</pre>
            </>
          )}
          {status !== 'pending' && (
            <>
              <div>
                <strong>{status === 'error' ? 'Error:' : 'Result:'}</strong>
              </div>
              <pre>
                {typeof result === 'object'
                  ? JSON.stringify(result, null, 2)
                  : String(result ?? '')}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const MCP_STATUS_LABEL = {
  disconnected: 'MCP not detected',
  connecting: 'Connecting to MCP…',
  connected: 'MCP connected',
  'paired-elsewhere': 'MCP paired with another tab'
};

const MCPStatusBar = ({
  status,
  port,
  lastError,
  readOnly,
  onToggleReadOnly,
  onReconnect
}) => {
  const isConnected = status === 'connected';
  const tooltip =
    status === 'disconnected'
      ? `No relay listening on 127.0.0.1:${port}. Start it from Claude Desktop or Code, then click Reconnect.`
      : status === 'paired-elsewhere'
        ? lastError ||
          'Another browser tab owns the MCP connection. Close it and reconnect to take over.'
        : status === 'connecting'
          ? `Trying ws://127.0.0.1:${port}…`
          : `Paired to ws://127.0.0.1:${port}`;
  return (
    <div className={styles.mcpStatusBar} title={tooltip}>
      <span
        className={`${styles.mcpStatusDot} ${styles[`mcpStatus_${status}`]}`}
      />
      <span className={styles.mcpStatusLabel}>{MCP_STATUS_LABEL[status]}</span>
      {(status === 'disconnected' || status === 'paired-elsewhere') && (
        <button
          type="button"
          className={styles.mcpStatusButton}
          onClick={onReconnect}
          title="Try connecting again"
        >
          <AwesomeIcon icon={faPlug} />
          <span>Reconnect</span>
        </button>
      )}
      {isConnected && (
        <button
          type="button"
          className={`${styles.mcpStatusButton} ${
            readOnly ? styles.mcpReadOnlyOn : ''
          }`}
          onClick={onToggleReadOnly}
          title={
            readOnly
              ? 'Read-only mode on: mutating tools rejected'
              : 'Toggle read-only mode (block scene mutations from the MCP)'
          }
        >
          <AwesomeIcon icon={readOnly ? faLock : faLockOpen} />
          <span>{readOnly ? 'Read-only' : 'Allow edits'}</span>
        </button>
      )}
    </div>
  );
};

// Helper component to render message content with Markdown
const MessageContent = ({ content, isAssistant = false }) => {
  // Only show copy button for messages longer than this threshold
  const COPY_BUTTON_THRESHOLD = 200;

  return (
    <div className={styles.markdownContent}>
      <ReactMarkdown>{content}</ReactMarkdown>
      {isAssistant && content.length > COPY_BUTTON_THRESHOLD && (
        <div className={styles.markdownFooter}>
          <CopyButton textContent={content} />
        </div>
      )}
    </div>
  );
};

// Build a friendly label for an entity (or entity id) for command pills.
const getEntityLabel = (idOrEntity) => {
  if (!idOrEntity) return '';
  let entity;
  if (typeof idOrEntity === 'string') {
    entity = document.getElementById(idOrEntity);
    if (!entity) return idOrEntity;
  } else {
    entity = idOrEntity;
  }
  const get = (attr) =>
    typeof entity.getAttribute === 'function'
      ? entity.getAttribute(attr)
      : null;
  const layerName = get('data-layer-name');
  if (layerName) return layerName;
  const mixin = get('mixin');
  if (mixin) return mixin.split(' ')[0];
  const cls = get('class');
  if (cls) return cls.split(' ')[0];
  return entity.id || entity.tagName?.toLowerCase?.() || 'entity';
};

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const formatValue = (v) => {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : Number(v.toFixed(2)).toString();
  }
  if (typeof v === 'string') return truncate(v, 24);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('x' in v && 'y' in v) {
      const parts = [v.x, v.y];
      if ('z' in v) parts.push(v.z);
      return parts.map((n) => formatValue(n)).join(', ');
    }
    try {
      return truncate(JSON.stringify(v), 40);
    } catch {
      return '[object]';
    }
  }
  return truncate(String(v), 24);
};

const VEC_AXES = ['x', 'y', 'z', 'w'];

// Try to parse "0 0 0" / "0 0 0 0" style stringified vec values.
const parseVecString = (s) => {
  if (typeof s !== 'string') return null;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts;
};

// For an entityupdate without an explicit `property`, try to narrow the diff
// down to the specific axes/keys that actually changed (so a position-x drag
// shows `position.x` rather than the whole vec3).
const diffComponentChange = (component, oldValue, newValue) => {
  // Single-property components stringify vec values; diff them numerically.
  const oldVec = parseVecString(oldValue);
  const newVec = parseVecString(newValue);
  if (oldVec && newVec && oldVec.length === newVec.length) {
    const changed = [];
    for (let i = 0; i < newVec.length; i++) {
      if (oldVec[i] !== newVec[i]) changed.push(i);
    }
    if (changed.length === 0) return null;
    if (changed.length === 1) {
      const i = changed[0];
      return {
        path: `${component}.${VEC_AXES[i]}`,
        oldV: formatValue(oldVec[i]),
        newV: formatValue(newVec[i])
      };
    }
    const axes = changed.map((i) => VEC_AXES[i]).join('');
    return {
      path: `${component}.${axes}`,
      oldV: changed.map((i) => formatValue(oldVec[i])).join(', '),
      newV: changed.map((i) => formatValue(newVec[i])).join(', ')
    };
  }

  // Multi-property components store objects; diff by changed keys.
  if (
    oldValue &&
    newValue &&
    typeof oldValue === 'object' &&
    typeof newValue === 'object' &&
    !Array.isArray(oldValue) &&
    !Array.isArray(newValue)
  ) {
    const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    // Comparing formatted (truncated) values rather than raw ones — two
    // values that diverge only past formatValue's 24-char cutoff will look
    // identical here. Acceptable for picking which key to show in the pill;
    // the underlying command still records the full diff.
    const changedKeys = [...keys].filter(
      (k) => formatValue(oldValue[k]) !== formatValue(newValue[k])
    );
    if (changedKeys.length === 1) {
      const k = changedKeys[0];
      return {
        path: `${component}.${k}`,
        oldV: formatValue(oldValue[k]),
        newV: formatValue(newValue[k])
      };
    }
  }

  return null;
};

// Returns { target, detail } describing a command beyond its display name.
const describeCommand = (cmd) => {
  if (!cmd || typeof cmd !== 'object') return { target: '', detail: '' };
  switch (cmd.type) {
    case 'entityupdate': {
      const target = getEntityLabel(cmd.entityId);
      let path, oldV, newV;
      if (cmd.property) {
        path = `${cmd.component}.${cmd.property}`;
        oldV = formatValue(cmd.oldValue);
        newV = formatValue(cmd.newValue);
      } else {
        const diff = diffComponentChange(
          cmd.component,
          cmd.oldValue,
          cmd.newValue
        );
        if (diff) {
          ({ path, oldV, newV } = diff);
        } else {
          path = cmd.component;
          oldV = formatValue(cmd.oldValue);
          newV = formatValue(cmd.newValue);
        }
      }
      return { target, detail: `${path}: ${oldV} → ${newV}` };
    }
    case 'entityclone': {
      const source = getEntityLabel(cmd.entityIdToClone);
      const cloneLabel = cmd.entityId ? getEntityLabel(cmd.entityId) : null;
      return {
        target: source,
        detail: cloneLabel ? `→ ${cloneLabel}` : ''
      };
    }
    case 'entitycreate': {
      const target = cmd.entityId ? getEntityLabel(cmd.entityId) : 'entity';
      const def = cmd.definition || {};
      const hint =
        def.mixin?.split?.(' ')[0] ||
        def['data-layer-name'] ||
        def.class?.split?.(' ')[0] ||
        def.element ||
        '';
      return { target, detail: hint };
    }
    case 'entityremove': {
      const target = cmd.entity ? getEntityLabel(cmd.entity) : 'entity';
      return { target, detail: '' };
    }
    case 'entityreparent': {
      const target = getEntityLabel(cmd.entityId);
      const newParent = getEntityLabel(cmd.newParentEl);
      return {
        target,
        detail: `→ ${newParent}@${cmd.newIndexInParent}`
      };
    }
    case 'componentadd':
    case 'componentremove': {
      const target = getEntityLabel(cmd.entityId);
      const valueStr =
        cmd.type === 'componentadd' && cmd.value !== undefined
          ? `: ${formatValue(cmd.value)}`
          : '';
      return { target, detail: `${cmd.component}${valueStr}` };
    }
    case 'multi': {
      const count = cmd.commands?.length ?? 0;
      return { target: '', detail: `${count} change${count === 1 ? '' : 's'}` };
    }
    default:
      return { target: '', detail: '' };
  }
};

/**
 * Generates an enhanced system prompt by appending available mixin information
 * @returns {string} The enhanced system prompt with mixin information
 */
const getEnhancedSystemPrompt = () => {
  // Get available mixins - this needs to happen at runtime when A-Frame is initialized
  const availableMixins = getGroupedMixinOptions(false)
    .flatMap((group) => group.options.map((option) => option.value))
    .join(', ');

  // Append the mixin information to the system prompt
  return (
    systemPrompt +
    `
  Available models (mixins) are:
  ${availableMixins}
  `
  );
};

function AIChatPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [latestResponseId, setLatestResponseId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [mcpReadOnly, setMcpReadOnly] = useState(false);
  // Hide the MCP UI for users who never opted in. Flips true once we
  // actually pair (`mcp.status === 'connected'`) or the user types `/mcp`.
  const [mcpVisible, setMcpVisible] = useState(false);
  const chatContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const { currentUser } = useAuthContext();
  const setModal = useStore((state) => state.setModal);
  const rightPanelTab = useStore((state) => state.rightPanelTab);
  const setRightPanelTab = useStore((state) => state.setRightPanelTab);

  const modelRef = useRef(null);
  // Set when the user explicitly opts into MCP (typed `/mcp` or arrived via
  // the auto-pair URL). Used to gate the post-pair success message so users
  // who never engaged with MCP don't see a "return to your MCP client"
  // message they have no context for.
  const awaitingPairRef = useRef(false);

  const mcp = useMCPClient({
    currentUser,
    readOnly: mcpReadOnly,
    // Without explicit user intent, do a single quiet probe and idle —
    // don't want to surface an MCP UI to users who never installed the relay.
    persistRetries: mcpVisible
  });

  const postPairSuccess = () => {
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: MCP_PAIR_SUCCESS_MARKDOWN,
        timestamp: new Date()
      }
    ]);
  };

  // First successful pair "unlocks" the bar for the rest of the session.
  // When the user explicitly engaged (`/mcp` or auto-pair URL) and the
  // status transitions to 'connected', post a confirmation in the chat so
  // they know to switch back to their MCP client to continue the workflow.
  useEffect(() => {
    if (mcp.status !== 'connected') return;
    setMcpVisible(true);
    if (!awaitingPairRef.current) return;
    awaitingPairRef.current = false;
    postPairSuccess();
  }, [mcp.status]);

  // Drop the pending-pair intent if retries stop (`mcpVisible` off → the
  // hook idles) or the connection was kicked by another tab
  // (`paired-elsewhere` doesn't auto-recover). Without this, a stale
  // `awaitingPairRef = true` would survive forever and a much later
  // reconnect — long after the user moved on — would surface a confusing
  // "MCP relay paired" message. Unmount cleanup is split into its own
  // mount-only effect so it doesn't fire on every status flip and race
  // the success effect above.
  useEffect(() => {
    if (mcp.status === 'paired-elsewhere' || !mcpVisible) {
      awaitingPairRef.current = false;
    }
  }, [mcp.status, mcpVisible]);

  useEffect(() => {
    return () => {
      awaitingPairRef.current = false;
    };
  }, []);

  // Auto-pair on `#mcp` (or `#mcp=PORT`) URL fragment. Equivalent to the
  // user typing `/mcp` and clicking Reconnect, but skips the manual step
  // entirely — the relay's startup banner prints this URL so the only
  // pairing action is opening the link.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    if (!/^#mcp(?:=\d+)?$/.test(hash)) return;
    setRightPanelTab('console');
    setMcpVisible(true);
    if (mcp.status === 'connected') {
      // Already paired (panel remount, hot reload, etc). The transition
      // effect won't fire because there's no status change, so emit the
      // confirmation inline instead of leaving the user without feedback.
      postPairSuccess();
    } else {
      awaitingPairRef.current = true;
      // Idempotent: reconnect() no-ops if the hook's mount probe is
      // already in flight (CONNECTING) or has already paired (OPEN).
      // Calling it unconditionally also covers the case where the
      // probe gave up in idle mode and we need a fresh attempt.
      mcp.reconnect();
    }
    // Strip the hash so a refresh doesn't re-trigger and the URL bar isn't
    // cluttered. `replaceState` keeps history clean (no stale forward entry).
    try {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    } catch {
      // best-effort — older browsers without replaceState just keep the hash
    }
    // Mount-only: read the URL once at startup. Subsequent pairing should
    // go through the normal `/mcp` command flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interleave Gemini chat messages with incoming MCP frames so a single
  // chronological feed shows both LLM channels. Both arrays already carry
  // Date timestamps; sort once per render.
  const renderedMessages = useMemo(() => {
    if (mcp.transcript.length === 0) return messages;
    const mcpEntries = mcp.transcript.map((t) => ({
      ...t,
      type: 'mcpFrame'
    }));
    const merged = messages.concat(mcpEntries);
    merged.sort((a, b) => {
      const at = a.timestamp ? a.timestamp.getTime() : 0;
      const bt = b.timestamp ? b.timestamp.getTime() : 0;
      return at - bt;
    });
    return merged;
  }, [messages, mcp.transcript]);

  // Focus the textarea when the console tab becomes active so Enter sends the
  // command instead of re-clicking the tab button that was just focused.
  useEffect(() => {
    if (rightPanelTab === 'console' && currentUser) {
      textareaRef.current?.focus();
    }
  }, [rightPanelTab, currentUser]);

  // Resize the textarea to fit its content. Runs after DOM updates and
  // before paint so the user never sees a one-frame flash at the wrong size.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Click the pill arrow to rewind/replay history up to that command.
  // If the pill is currently active, undo back through it (and everything
  // after). If it is undone, redo forward through it.
  const handlePillRewind = (pill) => {
    const history = AFRAME.INSPECTOR?.history;
    if (!history) return;
    if (!pill.undone) {
      const idx = history.undos.findIndex((c) => c.id === pill.commandId);
      if (idx === -1) return;
      const steps = history.undos.length - idx;
      for (let i = 0; i < steps; i++) AFRAME.INSPECTOR.undo();
      posthog.capture('console_pill_undo', { steps });
    } else {
      const idx = history.redos.findIndex((c) => c.id === pill.commandId);
      if (idx === -1) return;
      const steps = history.redos.length - idx;
      for (let i = 0; i < steps; i++) AFRAME.INSPECTOR.redo();
      posthog.capture('console_pill_redo', { steps });
    }
  };

  // Stream undo/redo command history into the console as pills.
  useEffect(() => {
    const handleHistoryChanged = (cmd) => {
      // history.clear() emits a null cmd. Drop pills then — their commandIds
      // no longer exist in any queue, and the idCounter resets to 0 so new
      // commands could even collide with surviving pills.
      if (cmd === null) {
        setMessages((prev) => prev.filter((m) => m.type !== 'commandPill'));
        return;
      }
      if (typeof cmd !== 'object') return;
      // History.execute() assigns a monotonic id to every command, but guard
      // anyway — without it, dedup falls back to matching `commandId ===
      // undefined` and would stomp unrelated pills together.
      if (cmd.id == null) return;
      const history = AFRAME.INSPECTOR?.history;
      if (!history) return;
      const isInUndos = history.undos.includes(cmd);

      const { target, detail } = describeCommand(cmd);

      setMessages((prev) => {
        const existingIdx = prev.findIndex(
          (m) => m.type === 'commandPill' && m.commandId === cmd.id
        );

        if (existingIdx === -1) {
          if (!isInUndos) return prev;
          const pill = {
            type: 'commandPill',
            id: `cmd_${cmd.id}`,
            commandId: cmd.id,
            name: cmd.name || cmd.type || 'Command',
            commandType: cmd.type,
            target,
            detail,
            timestamp: new Date(),
            undone: false
          };
          const next = [...prev, pill];
          // Cap pill count: drop the oldest pill (chat messages are untouched)
          // so a long editing session can't grow the list without bound.
          let pillCount = 0;
          for (const m of next) if (m.type === 'commandPill') pillCount++;
          if (pillCount <= MAX_PILLS) return next;
          const oldestPillIdx = next.findIndex((m) => m.type === 'commandPill');
          if (oldestPillIdx === -1) return next;
          return next.filter((_, i) => i !== oldestPillIdx);
        }

        // Same id seen again: either a redo (was undone, now back in undos),
        // an undo (now in redos), or an updatable update that mutated values.
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          target,
          detail,
          undone: !isInUndos
        };
        return updated;
      });
    };

    Events.on('historychanged', handleHistoryChanged);
    return () => {
      Events.off('historychanged', handleHistoryChanged);
    };
  }, []);

  useEffect(() => {
    const initializeAI = async () => {
      try {
        // Get the enhanced system prompt with mixin information
        const enhancedSystemPrompt = getEnhancedSystemPrompt();

        const model = getGenerativeModel(ai, {
          model: AI_MODEL_ID,
          tools: [entityTools],
          systemInstruction: enhancedSystemPrompt
        });

        // Initialize the model with an empty chat history
        // The history will be sent with each message instead
        modelRef.current = model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 2000
          },
          labels: {
            AI_CONVERSATION_ID: AI_CONVERSATION_ID
          }
        });
        console.log('Vertex AI chat initialized successfully');
      } catch (error) {
        console.error('Error initializing Vertex AI:', error);
      }
    };

    initializeAI();

    // Add event listener for newScene event to reset conversation
    const handleNewScene = () => {
      resetConversation();
    };

    AFRAME.scenes[0].addEventListener('newScene', handleNewScene);

    // Cleanup event listener on component unmount
    return () => {
      AFRAME.scenes[0].removeEventListener('newScene', handleNewScene);
    };
  }, []);

  const processMessage = async (messageText) => {
    if (!messageText.trim() || !modelRef.current) return;

    setIsLoading(true);
    const userMessage = {
      role: 'user',
      content: messageText,
      timestamp: new Date()
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const entity = document.getElementById('street-container');
      const data = STREET.utils.convertDOMElToObject(entity);
      const filteredData = STREET.utils.filterJSONstreet(data);
      const sceneJSON = JSON.parse(filteredData).data;

      // Get scene title from zustand store
      const { sceneTitle } = useStore.getState();

      // Get the enhanced system prompt with mixin information
      const enhancedSystemPrompt = getEnhancedSystemPrompt();

      // Get selected entity info if available
      let selectedEntityInfo = 'No entity currently selected';
      if (AFRAME.INSPECTOR && AFRAME.INSPECTOR.selectedEntity) {
        const selectedEntity = AFRAME.INSPECTOR.selectedEntity;

        // Use getElementData directly to get just the entity data
        const entityData = STREET.utils.getElementData(selectedEntity);

        // Convert to a nicely formatted JSON string
        selectedEntityInfo = entityData
          ? JSON.stringify(entityData, null, 2)
          : 'Unable to get entity data';
      }
      console.log('Selected entity info:', selectedEntityInfo);

      const prompt = `
      The current scene has the following state:
      ${JSON.stringify(sceneJSON, null, 2)}

      Scene Title: ${sceneTitle || 'Untitled'}

      Currently selected entity:
      ${selectedEntityInfo}

      User request: ${messageText}

      `;

      console.log('Sending prompt to AI:', [prompt]);

      // Filter out function call messages for the history
      const historyMessages = messages
        .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
        .map((msg) => ({
          role: msg.role,
          content: msg.content
        }));

      // Send message and get response with the full history
      const result = await modelRef.current.sendMessage(prompt, {
        history: historyMessages,
        systemPrompt: enhancedSystemPrompt // Use the enhanced system prompt with mixin information
      });
      console.log('Raw result:', result);

      const response = result.response;
      const responseText = response.text();

      posthog.capture('$ai_generation', {
        $ai_model: AI_MODEL_ID,
        $ai_provider: 'vertexai',
        $ai_trace_id: AI_CONVERSATION_ID,
        $ai_input: [{ role: 'user', content: messageText }],
        $ai_input_tokens: response.usageMetadata.promptTokenCount,
        $ai_output_choices: [{ role: 'assistant', content: responseText }],
        $ai_output_tokens: response.usageMetadata.candidatesTokenCount
      });

      // Get function calls
      const functionCalls = response.functionCalls();

      // Generate a unique response ID for this entire response (text + any function calls)
      const responseId = Date.now() + Math.random().toString(16).slice(2);

      // Set this as the latest response ID
      setLatestResponseId(responseId);

      // Always add AI text message first if there's actual text content
      if (responseText && responseText.trim()) {
        const aiMessage = {
          role: 'assistant',
          content: responseText,
          responseId: responseId, // Add the response ID
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, aiMessage]);
      }

      // Then process all function calls
      if (functionCalls && functionCalls.length > 0) {
        // Process function calls sequentially using async/await
        const processFunctionCalls = async () => {
          for (const call of functionCalls) {
            // Create a function call object with pending status
            const functionCallObj = {
              type: 'functionCall',
              id: Date.now() + Math.random().toString(16).slice(2),
              responseId: responseId, // Add the response ID
              name: call.name,
              args: call.args || {},
              status: 'pending',
              result: null,
              timestamp: new Date()
            };

            // Add the function call to the messages array
            setMessages((prev) => [...prev, functionCallObj]);

            try {
              // Validate that the function name exists in the function declarations
              const functionExists = entityTools.functionDeclarations.some(
                (func) => func.name === call.name
              );

              if (!functionExists) {
                throw new Error(
                  `Unknown function: ${call.name}. Please use one of the available functions.`
                );
              }

              // Execute the function using the AIChatTools module
              const result = await AIChatTools.executeFunction(
                call.name,
                call.args,
                currentUser
              );

              // Special handling for takeSnapshot function
              if (call.name === 'takeSnapshot' && result && result.imageData) {
                // Create a container for the snapshot message with the image data
                const snapshotMessage = {
                  type: 'snapshot',
                  id: Date.now() + Math.random().toString(16).slice(2),
                  responseId: functionCallObj.responseId, // Use the same response ID
                  caption: result.caption,
                  imageData: result.imageData,
                  timestamp: new Date()
                };

                // Add the snapshot message to the messages array
                setMessages((prev) => [...prev, snapshotMessage]);
              }

              const safeStringify = (val) => {
                try {
                  return JSON.stringify(val);
                } catch {
                  return '[unserializable]';
                }
              };

              const resultStr =
                typeof result === 'object'
                  ? call.name === 'takeSnapshot'
                    ? 'Snapshot taken successfully'
                    : safeStringify(result)
                  : String(result ?? '');

              // Track function call execution in PostHog
              posthog.capture('ai_function_call', {
                $ai_trace_id: AI_CONVERSATION_ID,
                ai_function_name: call.name,
                ai_function_args: safeStringify(call.args || {}),
                ai_function_status: 'success',
                ai_function_result: resultStr.slice(0, 2000),
                ai_response_id: responseId,
                ai_user_prompt: messageText
              });

              // Update function call status to success
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'functionCall' && msg.id === functionCallObj.id
                    ? {
                        ...msg,
                        status: 'success',
                        result: resultStr
                      }
                    : msg
                )
              );
            } catch (error) {
              console.error(`Error executing function ${call.name}:`, error);

              // Track failed function call in PostHog
              const safeStringifyErr = (val) => {
                try {
                  return JSON.stringify(val);
                } catch {
                  return '[unserializable]';
                }
              };
              posthog.capture('ai_function_call', {
                $ai_trace_id: AI_CONVERSATION_ID,
                ai_function_name: call.name,
                ai_function_args: safeStringifyErr(call.args || {}),
                ai_function_status: 'error',
                ai_function_result: error?.message ?? String(error),
                ai_response_id: responseId,
                ai_user_prompt: messageText
              });

              // Update function call status to error
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'functionCall' && msg.id === functionCallObj.id
                    ? {
                        ...msg,
                        status: 'error',
                        result: error.message
                      }
                    : msg
                )
              );
            }
          }
        };

        // Start processing function calls and add rating message when done
        processFunctionCalls().then(() => {
          // Now add the rating message after all function calls are processed
          const ratingMessage = {
            type: 'rating',
            id: Date.now() + Math.random().toString(16).slice(2),
            responseId: responseId,
            isRated: false,
            timestamp: new Date()
          };
          setMessages((prev) => [...prev, ratingMessage]);
        });
      }

      // For text-only responses (no function calls), add the rating immediately
      // Otherwise it will be added after function calls via the .then() callback
      if (!functionCalls || functionCalls.length === 0) {
        const ratingMessage = {
          type: 'rating',
          id: Date.now() + Math.random().toString(16).slice(2),
          responseId: responseId,
          isRated: false,
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, ratingMessage]);
      }

      // If no text response was found and there were no function calls, show a fallback message
      if (
        !responseText.trim() &&
        (!functionCalls || functionCalls.length === 0)
      ) {
        const aiMessage = {
          role: 'assistant',
          content: 'No response available',
          isRecoverable: true,
          responseId: responseId, // Add the response ID
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, aiMessage]);

        // Add rating message right after the fallback message
        const ratingMessage = {
          type: 'rating',
          id: Date.now() + Math.random().toString(16).slice(2),
          responseId: responseId,
          isRated: false,
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, ratingMessage]);
      }

      // We'll add the rating message after all function calls are processed
      // This will happen in the processFunctionCalls().then() callback
    } catch (error) {
      // Log full error to console for debugging — never to chat UI, since
      // SDK errors routinely embed endpoint URLs, auth details, and quota
      // metadata that we don't want to surface to users.
      console.error('Error generating response:', error);
      const errorResponseId = Date.now() + Math.random().toString(16).slice(2);
      setLatestResponseId(errorResponseId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Sorry, I encountered an error. Please try again, or reset the chat.',
          isRecoverable: true,
          responseId: errorResponseId,
          timestamp: new Date()
        },
        {
          type: 'rating',
          id: Date.now() + Math.random().toString(16).slice(2),
          responseId: errorResponseId,
          isRated: false,
          timestamp: new Date()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const showHelpMessage = (rawInput) => {
    const userMessage = {
      role: 'user',
      content: rawInput,
      timestamp: new Date()
    };
    const helpMessage = {
      type: 'help',
      id: `help_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      timestamp: new Date(),
      examples: HELP_EXAMPLES,
      commands: HELP_COMMANDS
    };
    setMessages((prev) => [...prev, userMessage, helpMessage]);
  };

  const showMCPHelpMessage = (rawInput) => {
    setMcpVisible(true);
    awaitingPairRef.current = true;
    if (mcp.status !== 'connected' && mcp.status !== 'connecting') {
      mcp.reconnect();
    }
    const userMessage = {
      role: 'user',
      content: rawInput,
      timestamp: new Date()
    };
    const helpMessage = {
      role: 'assistant',
      content: MCP_HELP_MARKDOWN,
      timestamp: new Date()
    };
    setMessages((prev) => [...prev, userMessage, helpMessage]);
  };

  // Handler for the send button in the chat interface
  const handleSendMessage = async () => {
    const currentInput = input;
    setInput(''); // Clear the input field immediately
    const trimmed = currentInput.trim().toLowerCase();
    if (trimmed.startsWith('/help')) {
      showHelpMessage(currentInput);
      return;
    }
    if (trimmed === '/mcp') {
      showMCPHelpMessage(currentInput);
      return;
    }
    await processMessage(currentInput);
  };

  // Scroll to bottom when new messages are added (includes MCP frames).
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages, mcp.transcript]);

  const resetConversation = () => {
    // Preserve command history pills — the underlying A-Frame undo stack
    // survives the reset, so the visual timeline should too. Only clear
    // chat-side messages (user/assistant/function calls/snapshots/ratings/help).
    setMessages((prev) => prev.filter((m) => m.type === 'commandPill'));
    setInput('');
    setShowResetConfirm(false);

    // Re-initialize the AI model with empty history
    const initializeAI = async () => {
      try {
        // Get the enhanced system prompt with mixin information
        const enhancedSystemPrompt = getEnhancedSystemPrompt();

        const model = getGenerativeModel(ai, {
          model: AI_MODEL_ID,
          tools: [entityTools],
          systemInstruction: enhancedSystemPrompt
        });
        // generate new uuid
        AI_CONVERSATION_ID = uuidv4();

        // Start a fresh chat with only the initial welcome message
        modelRef.current = model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 2000
          },
          labels: {
            AI_CONVERSATION_ID: AI_CONVERSATION_ID
          }
        });
        console.log('Vertex AI chat reinitialized with empty history');
      } catch (error) {
        console.error('Error reinitializing Vertex AI:', error);
      }
    };

    initializeAI();
  };

  // Function to handle response rating
  const handleResponseRating = (responseId, rating) => {
    // Gather context about the rated response from message history
    const relatedMessages = messages.filter(
      (msg) => msg.responseId === responseId
    );
    const functionCalls = relatedMessages
      .filter((msg) => msg.type === 'functionCall')
      .map((msg) => ({
        name: msg.name,
        args: msg.args,
        status: msg.status,
        result:
          typeof msg.result === 'string'
            ? msg.result.slice(0, 500)
            : String(msg.result)
      }));
    const aiTextResponse = relatedMessages.find(
      (msg) => msg.role === 'assistant'
    )?.content;

    // Find the user message that preceded this response.
    // User messages don't have responseId, so find the last user message
    // before the first message with this responseId.
    const firstResponseIdx = messages.findIndex(
      (msg) => msg.responseId === responseId
    );
    let userPrompt = '';
    if (firstResponseIdx > 0) {
      for (let i = firstResponseIdx - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userPrompt = messages[i].content;
          break;
        }
      }
    }

    // Log the rating to PostHog using the existing trace structure with user feedback
    posthog.capture('$ai_generation', {
      $ai_model: AI_MODEL_ID,
      $ai_provider: 'vertexai',
      $ai_trace_id: AI_CONVERSATION_ID,
      $ai_input: [
        {
          role: 'user',
          content:
            rating === 'thumbs_up'
              ? 'This response was helpful'
              : 'This response was not helpful'
        }
      ]
    });

    // Capture detailed feedback event with full context
    posthog.capture('ai_response_rating', {
      $ai_trace_id: AI_CONVERSATION_ID,
      ai_response_id: responseId,
      ai_rating: rating,
      ai_user_prompt: userPrompt || '',
      ai_text_response: aiTextResponse || '',
      ai_function_calls: functionCalls,
      ai_function_count: functionCalls.length,
      ai_function_names: functionCalls.map((fc) => fc.name).join(', '),
      ai_had_errors: functionCalls.some((fc) => fc.status === 'error'),
      $ai_model: AI_MODEL_ID
    });

    // Mark the response as rated in our local state
    setMessages((prev) =>
      prev.map((msg) =>
        msg.responseId === responseId ? { ...msg, isRated: true } : msg
      )
    );
  };

  return (
    <div className={`${styles.chatContainer} ai-chat-panel-container`}>
      <div className={styles.proFeaturesWrapper}>
        {mcpVisible && (
          <MCPStatusBar
            status={mcp.status}
            port={mcp.port}
            lastError={mcp.lastError}
            readOnly={mcpReadOnly}
            onToggleReadOnly={() => setMcpReadOnly((v) => !v)}
            onReconnect={mcp.reconnect}
          />
        )}
        {showResetConfirm && (
          <div className={styles.resetConfirmOverlay}>
            <div className={styles.resetConfirmModal}>
              <div className={styles.resetConfirmContent}>
                <p>
                  Are you sure you want to reset the conversation? This will
                  clear chat messages. Your command history pills will be kept.
                </p>
                <div className={styles.resetConfirmButtons}>
                  <button onClick={resetConversation}>Yes, reset</button>
                  <button onClick={() => setShowResetConfirm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={chatContainerRef} className={styles.chatMessages}>
          {renderedMessages.map((message, index) => {
            if (message.type === 'functionCall') {
              return (
                <FunctionCallMessage key={message.id} functionCall={message} />
              );
            } else if (message.type === 'mcpFrame') {
              return <MCPFrameMessage key={message.id} frame={message} />;
            } else if (message.type === 'snapshot') {
              return <SnapshotMessage key={message.id} snapshot={message} />;
            } else if (message.type === 'help') {
              return (
                <div key={message.id} className={styles.helpMessage}>
                  <div className={styles.helpHeader}>Try one of these:</div>
                  <div className={styles.helpExamples}>
                    {message.examples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        className={styles.helpExampleButton}
                        onClick={() => setInput(ex)}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                  {message.commands && message.commands.length > 0 && (
                    <>
                      <div className={styles.helpHeader}>Commands:</div>
                      <div className={styles.helpExamples}>
                        {message.commands.map((cmd) => (
                          <button
                            key={cmd.command}
                            type="button"
                            className={styles.helpExampleButton}
                            onClick={() => setInput(cmd.command)}
                            title={cmd.description}
                          >
                            <code>{cmd.command}</code> — {cmd.description}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            } else if (message.type === 'commandPill') {
              const tooltipContent = (
                <div>
                  <div className={styles.pillTooltipName}>{message.name}</div>
                  {message.target && (
                    <div className={styles.pillTooltipTarget}>
                      <strong>target:</strong> {message.target}
                    </div>
                  )}
                  {message.detail && (
                    <div className={styles.pillTooltipDetail}>
                      {message.detail}
                    </div>
                  )}
                  {message.undone && (
                    <div className={styles.pillTooltipUndoneNote}>(undone)</div>
                  )}
                </div>
              );
              return (
                <PillTooltip key={message.id} content={tooltipContent}>
                  <div
                    className={`${styles.commandPill} ${
                      message.undone ? styles.commandPillUndone : ''
                    }`}
                  >
                    <button
                      type="button"
                      className={styles.commandPillRewind}
                      onClick={() => handlePillRewind(message)}
                      title={
                        message.undone
                          ? 'Redo to here'
                          : 'Undo to before this command'
                      }
                    >
                      <AwesomeIcon
                        icon={message.undone ? faRotateRight : faRotateLeft}
                      />
                    </button>
                    <span className={styles.commandPillName}>
                      {message.name}
                    </span>
                    {message.target && (
                      <span className={styles.commandPillTarget}>
                        {message.target}
                      </span>
                    )}
                    {message.detail && (
                      <span className={styles.commandPillDetail}>
                        {message.detail}
                      </span>
                    )}
                    {message.undone && (
                      <span className={styles.commandPillBadge}>undone</span>
                    )}
                  </div>
                </PillTooltip>
              );
            } else if (message.type === 'rating') {
              const isLatest = message.responseId === latestResponseId;
              return (
                <div key={message.id} className={styles.ratingContainer}>
                  {isLatest && !message.isRated && (
                    <div className={styles.ratingButtons}>
                      <button
                        className={styles.ratingButton}
                        onClick={() =>
                          handleResponseRating(message.responseId, 'thumbs_up')
                        }
                        title="This response was helpful"
                      >
                        <AwesomeIcon icon={faThumbsUp} />
                      </button>
                      <button
                        className={styles.ratingButton}
                        onClick={() =>
                          handleResponseRating(
                            message.responseId,
                            'thumbs_down'
                          )
                        }
                        title="This response was not helpful"
                      >
                        <AwesomeIcon icon={faThumbsDown} />
                      </button>
                    </div>
                  )}
                  {isLatest && message.isRated && (
                    <div className={styles.ratingFeedback}>
                      Thank you for your feedback
                    </div>
                  )}
                </div>
              );
            } else {
              return (
                <div
                  key={index}
                  className={`${styles.chatMessage} ${styles[message.role]}`}
                >
                  {message.role === 'assistant' && (
                    <div className={styles.assistantAvatar}>
                      <ChatbotIcon />
                    </div>
                  )}
                  <MessageContent
                    content={message.content}
                    isAssistant={message.role === 'assistant'}
                  />
                  {message.isRecoverable && (
                    <button
                      onClick={resetConversation}
                      className={styles.inlineResetButton}
                      title="Clear chat history and start fresh"
                    >
                      <AwesomeIcon icon={faRotate} />
                      <span>Reset chat</span>
                    </button>
                  )}
                </div>
              );
            }
          })}
          {isLoading && (
            <div className={styles.loadingIndicator}>Thinking...</div>
          )}
        </div>

        <div className={styles.chatInputContainer}>
          <div className={styles.chatInput}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) {
                    return;
                  } else if (currentUser) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }
              }}
              placeholder="Type a command or type /help for options"
              disabled={!currentUser}
              rows="1"
              className={styles.chatTextarea}
              ref={textareaRef}
            />
            <div className={styles.actionButtons}>
              <div className={styles.rightButtons}>
                {messages.length > 0 && (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className={`${styles.resetButton} ${styles.greenIcon}`}
                    title="Reset console"
                    disabled={isLoading || !currentUser}
                  >
                    <AwesomeIcon icon={faRotate} />
                  </button>
                )}
                <button
                  className={styles.sendButton}
                  onClick={handleSendMessage}
                  disabled={isLoading || !currentUser}
                  title="Send"
                >
                  <ArrowUp24Icon />
                </button>
              </div>
            </div>
          </div>

          {!currentUser && (
            <div
              className={styles.proOverlay}
              onClick={() => setModal('signin')}
            >
              <div className={styles.proOverlayContent}>
                <span role="img" aria-label="lock">
                  🔒
                </span>
                <span>Please log in to send commands</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIChatPanel;
