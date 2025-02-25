import { useState, useEffect, useRef } from 'react';
import { vertexAI } from '../../services/firebase.js';
import { getGenerativeModel, Schema } from 'firebase/vertexai';
import Collapsible from '../Collapsible.js';
import JSONPretty from 'react-json-pretty';
import 'react-json-pretty/themes/monikai.css';
import { Copy32Icon } from '../../icons/index.js';
import { Parser } from 'expr-eval';

// Helper component for the copy button
const CopyButton = ({ jsonData }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
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

function evaluateExpression(expression) {
  try {
    const parser = new Parser();
    const cleanExpr = expression.trim();
    if (!/^[-+0-9\s()*/%.]*$/.test(cleanExpr)) {
      throw new Error('Invalid expression: contains forbidden characters');
    }
    return parser.evaluate(cleanExpr);
  } catch (error) {
    console.error('Error evaluating expression:', error);
    throw error;
  }
}

function executeUpdateCommand(command) {
  if (command.command && command.payload) {
    const updateCommandPayload = {
      entity: document.getElementById(command.payload['entity-id']),
      component: command.payload.component,
      property: command.payload.property,
      value: command.payload.value
    };
    console.log('updateCommandPayload:', updateCommandPayload);
    AFRAME.INSPECTOR.execute(command.command, updateCommandPayload);
  }
}

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

// Helper component to render message content with JSON formatting
const MessageContent = ({ content }) => {
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
        <div key={index} className={part.type === 'json' ? 'json-block' : ''}>
          {part.type === 'json' ? (
            <>
              <CopyButton jsonData={part.content} />
              <JSONPretty data={part.content} />
            </>
          ) : (
            <span>{part.content}</span>
          )}
        </div>
      ))}
    </>
  );
};

// Define the function declarations for entity operations
const entityTools = {
  functionDeclarations: [
    {
      name: 'entityCreateMixin',
      description:
        'Create a new entity in the A-Frame scene with specified components and transforms',
      parameters: Schema.object({
        properties: {
          mixin: Schema.string({
            description:
              'The mixin id value for the new entity (e.g., "box-truck-rig")'
          }),
          position: Schema.string({
            description:
              'Position as space-separated x y z values (e.g., "0 1.5 -3") default 0 0 0'
          }),
          rotation: Schema.string({
            description:
              'Rotation as space-separated x y z values in degrees (e.g., "0 45 0") default 0 0 0'
          }),
          scale: Schema.string({
            description:
              'Scale as space-separated x y z values (e.g., "2 2 2") default 1 1 1'
          })
        },
        optionalProperties: ['position', 'rotation', 'scale']
      })
    },
    {
      name: 'entityUpdate',
      description:
        'Update an entity in the A-Frame scene with new properties or components',
      parameters: Schema.object({
        properties: {
          'entity-id': Schema.string({
            description: 'The ID of the entity to update'
          }),
          component: Schema.string({
            description:
              'The component to update (e.g., position, rotation, mixin)'
          }),
          property: Schema.string({
            description:
              'The property to update within the component (optional)'
          }),
          value: Schema.string({
            description: 'The new value to set'
          }),
          'expression-for-value': Schema.string({
            description:
              'Mathematical expression to evaluate for the value (e.g., "5 - 2"). Use this instead of value when calculation is needed.'
          })
        },
        optionalProperties: ['value', 'expression-for-value', 'property']
      })
    }
  ]
};

const AIChatPanel = () => {
  const initialMessage = {
    role: 'assistant',
    content:
      'I am an AI assistant for the 3DStreet application. I can help you to analyze the scene, modify the scene or provide help about the 3DStreet editor. What do you need help with?'
  };

  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const chatContainerRef = useRef(null);

  const modelRef = useRef(null);

  const systemPrompt = `
      Context: You are an AI assistant for the 3DStreet application. 

      Please analyze the request and provide one of the following:
      1. If the user is asking about the scene, provide a natural language explanation
      2. If the user is asking to modify the scene, use the entityUpdate function
      3. If the user needs help, provide relevant guidance about the 3DStreet editor

      In the scene state, units for length are in meters, and rotations are in degrees.

      The orientation of axis to cardinal directions is as follows: x+ (positive) is north; x- (negative) is south; y+ (positive) is up; y- (negative) is down; z- (negative) is west; z+ (positive) is east;
      Models face z+ (east) when at 0º Y rotation. Increasing Y rotation will rotate the model to the left (anticlockwise). Therefore if a model is at 90º Y rotation and a user asks to "move it forward" it will be moving to the north.

      Make sure you convert everything to the appropriate units, even if the user uses different units.

      IMPORTANT: When you need to calculate a value (like "5 - 2"), return it as a string expression ("5 - 2") in a parameter named "expression-for-value"

      When changing a model, use the "entityupdate" command with the following payload:
      {
        "entity-id": "n9eLgB9C635T_edXuXIgz",
        "component": "mixin",
        "value": "fire-truck-rig"
      }

      The possible model (mixin) values are: Bicycle_1, bus, sedan-rig, sedan-taxi-rig, suv-rig, box-truck-rig, food-trailer-rig, fire-truck-rig, fire-ladder-rig, trash-truck-side-loading, self-driving-cruise-car-rig, self-driving-waymo-car, tuk-tuk, motorbike, cyclist-cargo, cyclist1, cyclist2, cyclist3, cyclist-kid, cyclist-dutch, char1, char2, char3, char4, char5, char6, char7, char8, char9, char10, char11, char12, char13, char14, char15, char16, tram, trolley, minibus, dividers-flowers, dividers-planting-strip, dividers-planter-box, dividers-bush, dividers-dome, safehit, bollard, temporary-barricade, temporary-traffic-cone, temporary-jersey-barrier-plastic, temporary-jersey-barrier-concrete, street-element-crosswalk-raised, street-element-traffic-island-end-rounded, street-element-sign-warning-ped-rrfb, street-element-traffic-post-k71, street-element-traffic-island, street-element-speed-hump, crosswalk-zebra-box, traffic-calming-bumps, corner-island, brt-station, outdoor_dining, bench_orientation_center, parklet, utility_pole, lamp-modern, lamp-modern-double, bikerack, bikeshare, lamp-traditional, palm-tree, bench, seawall, track, tree3, bus-stop, bus-stop-alternate, wayfinding, signal_left, signal_right, stop_sign, trash-bin, lending-library, residential-mailbox, USPS-mailbox, picnic-bench, large-parklet, SM3D_Bld_Mixed_Corner_4fl, SM3D_Bld_Mixed_Double_5fl, SM3D_Bld_Mixed_4fl_2, SM3D_Bld_Mixed_5fl, SM3D_Bld_Mixed_4fl, SM_Bld_House_Preset_03_1800, SM_Bld_House_Preset_08_1809, SM_Bld_House_Preset_09_1845, arched-building-01, arched-building-02, arched-building-03, arched-building-04, ElectricScooter_1, Character_1_M, magic-carpet, cyclist-cargo

      IMPORTANT: Always respond with a text message, even if the user is asking for a function call.

      You can invoke more than 1 function at a time.`;

  useEffect(() => {
    const initializeAI = async () => {
      try {
        const model = getGenerativeModel(vertexAI, {
          model: 'gemini-2.0-flash',
          tools: entityTools,
          systemInstruction: systemPrompt
        });

        // Initialize the model with an empty chat history
        // The history will be sent with each message instead
        modelRef.current = model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 1000
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

      // Get function calls
      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          console.log('Function call:', call);
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
            if (call.name === 'entityUpdate') {
              const args = call.args;
              // Convert function call args to command format, handling expressions
              const payload = {
                'entity-id': args['entity-id'],
                component: args.component
              };

              // Handle property if present
              if (args.property) {
                payload.property = args.property;
              }

              if (args['expression-for-value']) {
                payload.value = evaluateExpression(
                  args['expression-for-value']
                );
              } else {
                payload.value = args.value;
              }

              const commandData = {
                command: 'entityupdate',
                payload
              };
              executeUpdateCommand(commandData);

              // Update function call status to success
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'functionCall' && msg.id === functionCallObj.id
                    ? {
                        ...msg,
                        status: 'success',
                        result: 'Entity updated successfully'
                      }
                    : msg
                )
              );
            } else if (call.name === 'entityCreateMixin') {
              const newCommandPayload = {
                mixin: call.args.mixin,
                components: {
                  position: call.args.position || '0 0 0',
                  rotation: call.args.rotation || '0 0 0',
                  scale: call.args.scale || '1 1 1'
                }
              };
              console.log('newCommandPayload:', newCommandPayload);
              AFRAME.INSPECTOR.execute('entitycreate', newCommandPayload);

              // Update function call status to success
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'functionCall' && msg.id === functionCallObj.id
                    ? {
                        ...msg,
                        status: 'success',
                        result: 'Entity created successfully'
                      }
                    : msg
                )
              );
            }
          } catch (error) {
            console.error(`Error executing function ${call.name}:`, error);

            // Update function call status to error
            setMessages((prev) =>
              prev.map((msg) =>
                msg.type === 'functionCall' && msg.id === functionCallObj.id
                  ? {
                      ...msg,
                      status: 'error',
                      result: error.message || 'Error executing function'
                    }
                  : msg
              )
            );
          }
        }
      }

      // Only add AI text message if there's actual text content
      if (responseText && responseText.trim()) {
        console.log('Stored response text:', responseText);
        aiMessage = {
          role: 'assistant',
          content: responseText
        };
        setMessages((prev) => [...prev, aiMessage]);
      } else if (!functionCalls || functionCalls.length === 0) {
        // Only show "No text response" if there were no function calls
        aiMessage = {
          role: 'assistant',
          content: 'No text response available'
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
    const initialMessage = {
      role: 'assistant',
      content:
        'I am an AI assistant for the 3DStreet application. I can help you to analyze the scene, modify the scene or provide help about the 3DStreet editor. What do you need help with?'
    };

    setMessages([initialMessage]);
    setInput('');
    setShowResetConfirm(false);

    // Re-initialize the AI model with empty history
    const initializeAI = async () => {
      try {
        const model = getGenerativeModel(vertexAI, {
          model: 'gemini-2.0-flash',
          tools: entityTools,
          systemInstruction: systemPrompt
        });

        // Start a fresh chat with only the initial welcome message
        modelRef.current = model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 1000
          }
        });
        console.log('Vertex AI chat reinitialized with empty history');
        console.log('Vertex AI chat reinitialized successfully');
      } catch (error) {
        console.error('Error reinitializing Vertex AI:', error);
      }
    };

    initializeAI();
  };

  return (
    <div className="chat-panel-container">
      <Collapsible defaultCollapsed={false}>
        <div>AI Scene Assistant</div>
        <div className="chat-panel">
          <div ref={chatContainerRef} className="chat-messages">
            {messages.map((message, index) =>
              message.type === 'functionCall' ? (
                <FunctionCallMessage key={message.id} functionCall={message} />
              ) : (
                <div key={index} className={`chat-message ${message.role}`}>
                  <MessageContent content={message.content} />
                </div>
              )
            )}
            {isLoading && <div className="loading-indicator">Thinking...</div>}
          </div>

          <div className="chat-input">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about the scene..."
            />
            <button onClick={handleSendMessage} disabled={isLoading}>
              Send
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="reset-button"
              title="Reset conversation"
            >
              Reset
            </button>

            {showResetConfirm && (
              <div className="reset-confirm-modal">
                <div className="reset-confirm-content">
                  <p>
                    Are you sure you want to reset the conversation? This will
                    delete all messages.
                  </p>
                  <div className="reset-confirm-buttons">
                    <button onClick={resetConversation}>Yes, reset</button>
                    <button onClick={() => setShowResetConfirm(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Collapsible>
    </div>
  );
};

export default AIChatPanel;
