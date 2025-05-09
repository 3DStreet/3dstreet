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
  TrashIcon,
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

const AI_MODEL_ID = 'gemini-2.0-flash';
let AI_CONVERSATION_ID = uuidv4();

// Helper component for the copy button
const CopyButton = ({ jsonData, textContent }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (jsonData) {
        await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      } else if (textContent) {
        await navigator.clipboard.writeText(textContent);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button onClick={handleCopy} className="copy-button">
      <Copy32Icon />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
};

// Function call message component
const FunctionCallMessage = ({ functionCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { name, args, status, result } = functionCall;

  return (
    <div className={`chat-message function-call ${status}`}>
      <div
        className="function-call-summary"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={`status-indicator ${status}`}></span>
        <strong>{name}</strong>:{' '}
        {status === 'pending'
          ? 'Executing...'
          : status === 'success'
            ? 'Completed'
            : 'Failed'}
      </div>

      {isExpanded && (
        <div className="function-call-details">
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
    <div className={`chat-message snapshot ${styles.snapshotContainer}`}>
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

// Helper component to render message content with JSON formatting and Markdown
const MessageContent = ({ content, isAssistant = false }) => {
  // Only show copy button for messages longer than this threshold
  const COPY_BUTTON_THRESHOLD = 200;
  const formatContent = (text) => {
    const parts = [];
    let currentIndex = 0;
    const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;

    let match;
    while ((match = jsonBlockRegex.exec(text)) !== null) {
      if (match.index > currentIndex) {
        parts.push({
          type: 'text',
          content: text.slice(currentIndex, match.index)
        });
      }

      try {
        const jsonContent = JSON.parse(match[1]);
        parts.push({
          type: 'json',
          content: jsonContent
        });
      } catch (e) {
        parts.push({
          type: 'text',
          content: match[0]
        });
      }

      currentIndex = match.index + match[0].length;
    }

    if (currentIndex < text.length) {
      parts.push({
        type: 'text',
        content: text.slice(currentIndex)
      });
    }

    return parts;
  };

  const parts = formatContent(content);

  return (
    <>
      {parts.map((part, index) => (
        <div key={index}>
          <div className={styles.markdownContent}>
            <ReactMarkdown>{part.content}</ReactMarkdown>
            {isAssistant && part.content.length > COPY_BUTTON_THRESHOLD && (
              <div className={styles.markdownFooter}>
                <CopyButton textContent={part.content} />
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
};

const AIChatPanel = forwardRef(function AIChatPanel(props, ref) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const chatContainerRef = useRef(null);
  const { currentUser } = useAuthContext();
  const setModal = useStore((state) => state.setModal);

  const modelRef = useRef(null);

  useEffect(() => {
    const initializeAI = async () => {
      try {
        const model = getGenerativeModel(vertexAI, {
          model: AI_MODEL_ID,
          tools: entityTools,
          systemInstruction: systemPrompt
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
  }, []);

  const handleSendMessage = async () => {
    if (!input.trim() || !modelRef.current) return;

    setIsLoading(true);
    const userMessage = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    let aiMessage;

    try {
      const entity = document.getElementById('street-container');
      const data = STREET.utils.convertDOMElToObject(entity);
      const filteredData = STREET.utils.filterJSONstreet(data);
      const sceneJSON = JSON.parse(filteredData).data;

      const prompt = `
      The current scene has the following state:
      ${JSON.stringify(sceneJSON, null, 2)}

      User request: ${input}

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
        history: historyMessages
      });
      console.log('Raw result:', result);

      const response = result.response;
      const responseText = response.text();

      posthog.capture('$ai_generation', {
        $ai_model: AI_MODEL_ID,
        $ai_provider: 'vertexai',
        $ai_trace_id: AI_CONVERSATION_ID,
        $ai_input: [{ role: 'user', content: input }],
        $ai_input_tokens: response.usageMetadata.promptTokenCount,
        $ai_output_choices: [{ role: 'assistant', content: responseText }],
        $ai_output_tokens: response.usageMetadata.candidatesTokenCount
      });

      // Get function calls
      const functionCalls = response.functionCalls();

      // Always add AI text message first if there's actual text content
      if (responseText && responseText.trim()) {
        aiMessage = {
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
                call.args
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
        aiMessage = {
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

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const resetConversation = () => {
    setMessages([]);
    setInput('');
    setShowResetConfirm(false);

    // Re-initialize the AI model with empty history
    const initializeAI = async () => {
      try {
        const model = getGenerativeModel(vertexAI, {
          model: AI_MODEL_ID,
          tools: entityTools,
          systemInstruction: systemPrompt
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
    },
    // Set a message in the input field
    setUserMessage: (message) => {
      setInput(message);
    },
    // Submit the current message in the input field
    submitUserMessage: (directMessage) => {
      // If directMessage is provided, use it instead of waiting for state update
      if (directMessage) {
        // Create a temporary function that uses the direct message
        const sendDirectMessage = async () => {
          if (!directMessage.trim() || !modelRef.current) return;

          setIsLoading(true);
          const userMessage = { role: 'user', content: directMessage };
          setMessages((prev) => [...prev, userMessage]);
          setInput(''); // Clear the input field

          try {
            // Continue with the rest of handleSendMessage logic
            const entity = document.getElementById('street-container');
            const data = STREET.utils.convertDOMElToObject(entity);
            const filteredData = STREET.utils.filterJSONstreet(data);
            const sceneJSON = JSON.parse(filteredData).data;

            const prompt = `
            The current scene has the following state:
            ${JSON.stringify(sceneJSON, null, 2)}

            User request: ${directMessage}

            `;

            // Send the prompt to AI

            // Filter out function call messages for the history
            const historyMessages = messages
              .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
              .map((msg) => ({
                role: msg.role,
                content: msg.content
              }));

            // Send message and get response with the full history
            const result = await modelRef.current.sendMessage(prompt, {
              history: historyMessages
            });

            // Process response (same as in handleSendMessage)
            const response = result.response;
            const responseText = response.text();

            posthog.capture('$ai_generation', {
              $ai_model: AI_MODEL_ID,
              $ai_provider: 'vertexai',
              $ai_trace_id: AI_CONVERSATION_ID,
              $ai_input: [{ role: 'user', content: directMessage }],
              $ai_input_tokens: response.usageMetadata.promptTokenCount,
              $ai_output_choices: [
                { role: 'assistant', content: responseText }
              ],
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

            // Process function calls if any
            if (functionCalls && functionCalls.length > 0) {
              // Use the existing processFunctionCalls logic
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
                    const functionExists =
                      entityTools.functionDeclarations.some(
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
                      call.args
                    );

                    // Special handling for takeSnapshot function
                    if (
                      call.name === 'takeSnapshot' &&
                      result &&
                      result.imageData
                    ) {
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
                        msg.type === 'functionCall' &&
                        msg.id === functionCallObj.id
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
                    console.error(
                      `Error executing function ${call.name}:`,
                      error
                    );
                    // Update function call status to error
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.type === 'functionCall' &&
                        msg.id === functionCallObj.id
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

        // Execute the direct message function
        sendDirectMessage();
      } else {
        // Fall back to the original method which uses the input state
        handleSendMessage();
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
              <div></div> {/* Empty div for the left column */}
              <div className={styles['chat-title']}>
                {messages.length === 0 ? 'What can I help with?' : 'Assistant'}{' '}
                <ChatbotIcon />
              </div>
              <div className={styles['chat-actions']}>
                <button
                  className={styles.closeButton}
                  onClick={() => setIsOpen(false)}
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
            <div ref={chatContainerRef} className="chat-messages">
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
                    <div key={index} className={`chat-message ${message.role}`}>
                      {message.role === 'assistant' && index === 0 && (
                        <div className="assistant-avatar">
                          {/* <img
                            src="../../../ui_assets/cards/icons/dadbot.jpg"
                            alt="DadBot AI Assistant"
                          /> */}
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
                <div className="loading-indicator">Thinking...</div>
              )}
            </div>

            <div className={styles.chatInput}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) =>
                  e.key === 'Enter' && currentUser?.isPro && handleSendMessage()
                }
                placeholder="Ask anything"
                disabled={!currentUser?.isPro}
                style={{ color: '#fff' }} /* Ensure text is white */
              />
              <div className={styles.actionButtons}>
                <div className={styles.leftButtons}>
                  <button
                    className={styles.actionButton}
                    onClick={() => {}}
                    disabled={isLoading || !currentUser?.isPro}
                  >
                    Action1
                  </button>
                  <button
                    className={styles.actionButton}
                    onClick={() => {}}
                    disabled={isLoading || !currentUser?.isPro}
                  >
                    Action2
                  </button>
                  <button
                    className={styles.actionButton}
                    onClick={() => setModal('report')}
                    disabled={isLoading || !currentUser?.isPro}
                  >
                    📋 Generate Report
                  </button>
                </div>
                <div className={styles.rightButtons}>
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className={styles.resetButton}
                    title="Reset conversation"
                    disabled={isLoading || !currentUser?.isPro}
                  >
                    <TrashIcon />
                  </button>
                  <button
                    className={styles.sendButton}
                    onClick={handleSendMessage}
                    disabled={isLoading || !currentUser?.isPro}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
            {!currentUser?.isPro && (
              <div
                className={styles.proOverlay}
                onClick={() => setModal('payment')}
              >
                <div className={styles.proOverlayContent}>
                  <span role="img" aria-label="lock">
                    🔒
                  </span>
                  <span>Pro Feature - Upgrade Now</span>
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
