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

function executeCommand(command) {
  if (command.command && command.payload) {
    const newCommandPayload = {
      entity: document.getElementById(command.payload['entity-id']),
      component: command.payload.component,
      property: command.payload.property,
      value: command.payload.value
    };
    console.log('newCommandPayload:', newCommandPayload);
    AFRAME.INSPECTOR.execute(command.command, newCommandPayload);
  }
}

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

const AIChatPanel = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatContainerRef = useRef(null);
  const modelRef = useRef(null);

  // Define the function declaration for entity updates
  const entityUpdateTool = {
    functionDeclarations: [
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

  useEffect(() => {
    console.log('AIChatPanel mounted');
    const initializeAI = async () => {
      try {
        console.log('Initializing Vertex AI');
        modelRef.current = getGenerativeModel(vertexAI, {
          model: 'gemini-2.0-flash-exp',
          tools: entityUpdateTool
        });
        console.log('Vertex AI initialized successfully');
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
      Context: You are a 3D street scene assistant for the 3DStreet application. 
      The current scene has the following state:
      ${JSON.stringify(sceneJSON, null, 2)}

      User request: ${input}

      Please analyze the request and provide one of the following:
      1. If the user is asking about the scene, provide a natural language explanation
      2. If the user is asking to modify the scene, use the entityUpdate function
      3. If the user needs help, provide relevant guidance about the 3DStreet editor

      In the scene state, units for length are in meters, and rotations are in degrees.

      The orientation of axis to cardinal directions is as follows: x+ (positive) is north; x- (negative) is south; y+ (positive) is up; y- (negative) is down; z- (negative) is west; z+ (positive) is east;
      Models face z- (east) when at 0º Y rotation. 

      Make sure you convert everything to the appropriate units, even if the user uses different units.

      IMPORTANT: When you need to calculate a value (like "5 - 2"), return it as a string expression ("5 - 2") in a parameter named "expression-for-value"

      When changing a model, use the "entityupdate" command with the following payload:
      {
        "entityId": "n9eLgB9C635T_edXuXIgz",
        "component": "mixin",
        "value": "fire-truck-rig"
      }

      The possible model (mixin) values are: Bicycle_1, bus, sedan-rig, sedan-taxi-rig, suv-rig, box-truck-rig, food-trailer-rig, fire-truck-rig, fire-ladder-rig, trash-truck-side-loading, self-driving-cruise-car-rig, self-driving-waymo-car, tuk-tuk, motorbike, cyclist-cargo, cyclist1, cyclist2, cyclist3, cyclist-kid, cyclist-dutch, char1, char2, char3, char4, char5, char6, char7, char8, char9, char10, char11, char12, char13, char14, char15, char16, tram, trolley, minibus, dividers-flowers, dividers-planting-strip, dividers-planter-box, dividers-bush, dividers-dome, safehit, bollard, temporary-barricade, temporary-traffic-cone, temporary-jersey-barrier-plastic, temporary-jersey-barrier-concrete, street-element-crosswalk-raised, street-element-traffic-island-end-rounded, street-element-sign-warning-ped-rrfb, street-element-traffic-post-k71, street-element-traffic-island, street-element-speed-hump, crosswalk-zebra-box, traffic-calming-bumps, corner-island, brt-station, outdoor_dining, bench_orientation_center, parklet, utility_pole, lamp-modern, lamp-modern-double, bikerack, bikeshare, lamp-traditional, palm-tree, bench, seawall, track, tree3, bus-stop, bus-stop-alternate, wayfinding, signal_left, signal_right, stop_sign, trash-bin, lending-library, residential-mailbox, USPS-mailbox, picnic-bench, large-parklet, SM3D_Bld_Mixed_Corner_4fl, SM3D_Bld_Mixed_Double_5fl, SM3D_Bld_Mixed_4fl_2, SM3D_Bld_Mixed_5fl, SM3D_Bld_Mixed_4fl, SM_Bld_House_Preset_03_1800, SM_Bld_House_Preset_08_1809, SM_Bld_House_Preset_09_1845, arched-building-01, arched-building-02, arched-building-03, arched-building-04, ElectricScooter_1, Character_1_M, magic-carpet, cyclist-cargo

      IMPORTANT: Always respond with a brief text message, even if the user is asking for a function call. Do not describe the user's request.
      `;

      const chat = modelRef.current.startChat();
      const result = await chat.sendMessage(prompt);
      const response = await result.response;
      console.log('AI Chat response:', response);
      // Handle any function calls
      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          console.log('Function call:', call);
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
              payload.value = evaluateExpression(args['expression-for-value']);
            } else {
              payload.value = args.value;
            }

            const commandData = {
              command: 'entityupdate',
              payload
            };
            executeCommand(commandData);
          }
        }
      }

      // Get response text first and store it
      const responseText = response.text();
      console.log('Stored response text:', responseText);
      aiMessage = {
        role: 'assistant',
        content: responseText || 'No text response available'
      };
      setMessages((prev) => [...prev, aiMessage]);
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

  return (
    <div className="chat-panel-container">
      <Collapsible defaultCollapsed={false}>
        <div>AI Scene Assistant</div>
        <div className="chat-panel">
          <div ref={chatContainerRef} className="chat-messages">
            {messages.map((message, index) => (
              <div key={index} className={`chat-message ${message.role}`}>
                <MessageContent content={message.content} />
              </div>
            ))}
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
          </div>
        </div>
      </Collapsible>
    </div>
  );
};

export default AIChatPanel;
