import {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef
} from 'react';
import { vertexAI } from '../../services/firebase.js';
import { getGenerativeModel } from 'firebase/vertexai';
import {
  Copy32Icon,
  DownloadIcon,
  ChatbotIcon,
  Cross24Icon
} from '../../icons/index.js';
import { useAuthContext } from '../../contexts';
import useStore from '@/store';
import styles from './AIChatPanel.module.scss';
import posthog from 'posthog-js';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';
import { systemPrompt } from './AIChatPrompt.js';
import AIChatTools, { entityTools } from './AIChatTools.js';
import { PanelToggleButton } from '../../components/components';
import { AwesomeIcon } from '../components/AwesomeIcon';
import { faRotate } from '@fortawesome/free-solid-svg-icons';
import { getGroupedMixinOptions } from '../../lib/mixinUtils';

const AI_MODEL_ID = 'gemini-2.0-flash';
let AI_CONVERSATION_ID = uuidv4();

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

const AIChatPanel = forwardRef(function AIChatPanel(props, ref) {
  const [messages, setMessages] = useState([]);
  const isMessages = messages.length > 0;
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [savedScrollPosition, setSavedScrollPosition] = useState(0);
  const chatContainerRef = useRef(null);
  const { currentUser } = useAuthContext();
  const setModal = useStore((state) => state.setModal);

  const modelRef = useRef(null);

  useEffect(() => {
    const initializeAI = async () => {
      try {
        // Get the enhanced system prompt with mixin information
        const enhancedSystemPrompt = getEnhancedSystemPrompt();

        const model = getGenerativeModel(vertexAI, {
          model: AI_MODEL_ID,
          tools: entityTools,
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

  // Core function to process a message and get AI response
  // Add a new function to handle textarea auto-resize
  const adjustTextareaHeight = (element) => {
    if (!element) return;

    // Reset height to auto to get the correct scrollHeight
    element.style.height = 'auto';

    // Set the height to match the content (scrollHeight)
    element.style.height = `${element.scrollHeight}px`;
  };

  const processMessage = async (messageText) => {
    if (!messageText.trim() || !modelRef.current) return;

    setIsLoading(true);
    const userMessage = { role: 'user', content: messageText };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const entity = document.getElementById('street-container');
      const data = STREET.utils.convertDOMElToObject(entity);
      const filteredData = STREET.utils.filterJSONstreet(data);
      const sceneJSON = JSON.parse(filteredData).data;

      // Get project info from zustand store
      const { projectInfo, sceneTitle } = useStore.getState();

      // Get the enhanced system prompt with mixin information
      const enhancedSystemPrompt = getEnhancedSystemPrompt();

      const prompt = `
      The current scene has the following state:
      ${JSON.stringify(sceneJSON, null, 2)}
      
      Current project information:
      Scene Title: ${sceneTitle || 'Untitled'}
      Description: ${projectInfo.description || ''}
      Project Area: ${projectInfo.projectArea || ''}
      Current Condition: ${projectInfo.currentCondition || ''}
      Problem Statement: ${projectInfo.problemStatement || ''}
      Proposed Solutions: ${projectInfo.proposedSolutions || ''}

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

      // Always add AI text message first if there's actual text content
      if (responseText && responseText.trim()) {
        const aiMessage = {
          role: 'assistant',
          content: responseText
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
                  caption: result.caption,
                  imageData: result.imageData,
                  timestamp: new Date()
                };

                // Add the snapshot message to the messages array
                setMessages((prev) => [...prev, snapshotMessage]);
              }

              // Update function call status to success
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'functionCall' && msg.id === functionCallObj.id
                    ? {
                        ...msg,
                        status: 'success',
                        result:
                          typeof result === 'object'
                            ? call.name === 'takeSnapshot'
                              ? 'Snapshot taken successfully'
                              : JSON.stringify(result)
                            : result
                      }
                    : msg
                )
              );
            } catch (error) {
              console.error(`Error executing function ${call.name}:`, error);
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

        // Start processing function calls
        processFunctionCalls();
      }

      // If no text response was found and there were no function calls, show a fallback message
      if (
        !responseText.trim() &&
        (!functionCalls || functionCalls.length === 0)
      ) {
        const aiMessage = {
          role: 'assistant',
          content: 'No response available'
        };
        setMessages((prev) => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error('Error generating response:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.'
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler for the send button in the chat interface
  const handleSendMessage = async () => {
    const currentInput = input;
    setInput(''); // Clear the input field immediately
    await processMessage(currentInput);
  };

  // Scroll to bottom when new messages are added
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Restore scroll position when panel is opened
  useEffect(() => {
    if (isOpen && chatContainerRef.current && savedScrollPosition > 0) {
      // Use setTimeout to ensure the DOM has fully rendered
      setTimeout(() => {
        chatContainerRef.current.scrollTop = savedScrollPosition;
      }, 0);
    }
  }, [isOpen, savedScrollPosition]);

  const resetConversation = () => {
    setMessages([]);
    setInput('');
    setShowResetConfirm(false);

    // Re-initialize the AI model with empty history
    const initializeAI = async () => {
      try {
        // Get the enhanced system prompt with mixin information
        const enhancedSystemPrompt = getEnhancedSystemPrompt();

        const model = getGenerativeModel(vertexAI, {
          model: AI_MODEL_ID,
          tools: entityTools,
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

  // Expose methods to be called from outside components
  useImperativeHandle(ref, () => ({
    // Open the chat panel
    openPanel: () => {
      setIsOpen(true);
      // Scroll position will be restored via useEffect
    },
    // Reset the conversation
    resetConversation: () => {
      resetConversation();
    },
    // Set a message in the input field
    setUserMessage: (message) => {
      setInput(message);
    },
    // Submit the current message in the input field
    submitUserMessage: (directMessage) => {
      if (directMessage) {
        // If a direct message is provided, process it
        processMessage(directMessage);
      } else {
        // Otherwise use the current input value
        const currentInput = input;
        setInput(''); // Clear the input field immediately
        processMessage(currentInput);
      }
    }
  }));

  return (
    <>
      <div
        className={`${styles.aiChatToggle} ${isOpen ? styles.isOpen : ''} ai-chat-toggle-container`}
      >
        {!isOpen && (
          <PanelToggleButton
            icon={ChatbotIcon}
            isOpen={isOpen}
            onClick={() => setIsOpen(!isOpen)}
          >
            <span>Assistant</span>
          </PanelToggleButton>
        )}
      </div>

      {isOpen && (
        <div className={`${styles.chatContainer} ai-chat-panel-container`}>
          <div className={styles.proFeaturesWrapper}>
            <div className={styles['chat-header']}>
              <a
                href="https://3dstreet.com/blog/2025/05/22/introducing-ai-assistant-beta-your-creative-partner-for-street-design#the-fine-print-beta-status-and-availability"
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className={styles.betaPill}>Free Chat in Beta</div>
              </a>
              <div className={styles['chat-title']}>
                {!isMessages ? 'What can I help with?' : 'Assistant'}{' '}
                {/* <img
                            src="../../../ui_assets/cards/icons/dadbot.jpg"
                            alt="DadBot AI Assistant"
                          /> */}
                <ChatbotIcon />
              </div>
              <div className={styles['chat-actions']}>
                <button
                  className={styles.closeButton}
                  onClick={() => {
                    // Save scroll position before closing
                    if (chatContainerRef.current) {
                      setSavedScrollPosition(
                        chatContainerRef.current.scrollTop
                      );
                    }
                    setIsOpen(false);
                  }}
                  title="Close assistant"
                >
                  <Cross24Icon />
                </button>
              </div>
            </div>
            {showResetConfirm && (
              <div className={styles.resetConfirmOverlay}>
                <div className={styles.resetConfirmModal}>
                  <div className={styles.resetConfirmContent}>
                    <p>
                      Are you sure you want to reset the conversation? This will
                      delete all messages.
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
            {isMessages && (
              <div ref={chatContainerRef} className={styles.chatMessages}>
                {messages.map((message, index) => {
                  if (message.type === 'functionCall') {
                    return (
                      <FunctionCallMessage
                        key={message.id}
                        functionCall={message}
                      />
                    );
                  } else if (message.type === 'snapshot') {
                    return (
                      <SnapshotMessage key={message.id} snapshot={message} />
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
                      </div>
                    );
                  }
                })}
                {isLoading && (
                  <div className={styles.loadingIndicator}>Thinking...</div>
                )}
              </div>
            )}

            <div className={styles.chatInput}>
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  adjustTextareaHeight(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.shiftKey) {
                      // Let the default behavior happen (create a newline)
                      return;
                    } else if (currentUser) {
                      e.preventDefault(); // Prevent default to avoid creating a newline
                      handleSendMessage();
                    }
                  }
                }}
                placeholder={
                  isMessages ? 'Reply to Assistant...' : 'Ask anything'
                }
                disabled={!currentUser}
                rows="1"
                className={styles.chatTextarea}
                ref={(el) => {
                  if (el) adjustTextareaHeight(el);
                }}
              />
              <div className={styles.actionButtons}>
                <div className={styles.leftButtons}>
                  {!isMessages && (
                    <>
                      <button
                        className={styles.actionButton}
                        onClick={() =>
                          setInput(
                            'Make a basic street with 2 drive lanes, 2 sidewalks, and 2 bike lanes'
                          )
                        }
                        disabled={isLoading || !currentUser}
                      >
                        🛣️ Create a Street
                      </button>
                      <button
                        className={styles.actionButton}
                        onClick={() =>
                          setInput('take 3 snapshots with different types')
                        }
                        disabled={isLoading || !currentUser}
                      >
                        📸 Take Snapshots
                      </button>
                      <button
                        className={styles.actionButton}
                        onClick={() => setModal('report')}
                        disabled={isLoading || !currentUser}
                      >
                        📋 Generate Report
                      </button>
                    </>
                  )}
                </div>
                <div className={styles.rightButtons}>
                  {isMessages && (
                    <button
                      onClick={() => setShowResetConfirm(true)}
                      className={`${styles.resetButton} ${styles.greenIcon}`}
                      title="Reset conversation"
                      disabled={isLoading || !currentUser}
                    >
                      <AwesomeIcon icon={faRotate} />
                    </button>
                  )}
                  <button
                    className={styles.sendButton}
                    onClick={handleSendMessage}
                    disabled={isLoading || !currentUser}
                  >
                    Send
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
                  <span>Please log in to use the Assistant</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});

export default AIChatPanel;
