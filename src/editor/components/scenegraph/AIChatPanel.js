import { useState, useEffect, useRef } from 'react';
import { vertexAI } from '../../services/firebase.js';
import { getGenerativeModel, Schema } from 'firebase/vertexai';
import Collapsible from '../Collapsible.js';
import JSONPretty from 'react-json-pretty';
import 'react-json-pretty/themes/monikai.css';
import { Copy32Icon } from '../../icons/index.js';
import { Parser } from 'expr-eval';
import { useAuthContext } from '../../contexts';
import useStore from '@/store';
import styles from './AIChatPanel.module.scss';
import posthog from 'posthog-js';
import { v4 as uuidv4 } from 'uuid';

const AI_MODEL_ID = 'gemini-2.0-flash';
let AI_CONVERSATION_ID = uuidv4();

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
      entity: document.getElementById(command.payload.entityId),
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
          entityId: Schema.string({
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
          expressionForValue: Schema.string({
            description:
              'Mathematical expression to evaluate for the value (e.g., "5 - 2"). Use this instead of value when calculation is needed.'
          })
        },
        optionalProperties: ['value', 'expressionForValue', 'property']
      })
    },
    {
      name: 'managedStreetCreate',
      description:
        'Create a new managed street with specified segments and properties',
      parameters: Schema.object({
        properties: {
          name: Schema.string({
            description: 'Name of the street configuration'
          }),
          length: Schema.string({
            description: 'Length of the street in meters (default: 60)'
          }),
          position: Schema.string({
            description:
              'Position as space-separated x y z values (e.g., "0 0 0")'
          }),
          segments: Schema.array({
            description: 'Array of segment definitions for the street',
            items: Schema.object({
              properties: {
                name: Schema.string({
                  description: 'Display name of the segment'
                }),
                type: Schema.string({
                  description:
                    'Type of segment (e.g., "drive-lane", "bike-lane", "sidewalk", "parking-lane", "divider", "grass", "rail", "bus-lane")'
                }),
                surface: Schema.string({
                  description:
                    'Surface material (e.g., "asphalt", "concrete", "grass", "sidewalk", "gravel", "sand", "hatched", "planting-strip", "none", "solid")'
                }),
                color: Schema.string({
                  description: 'Hex color code (e.g., "#ffffff")'
                }),
                level: Schema.number({
                  description: 'Vertical offset (-1, 0, 1, 2)'
                }),
                width: Schema.number({
                  description: 'Width in meters'
                }),
                direction: Schema.string({
                  description:
                    'Traffic direction ("none", "inbound", "outbound")'
                }),
                generated: Schema.object({
                  description: 'Optional generated content',
                  properties: {
                    clones: Schema.array({
                      description:
                        'Clones configuration for repeated 3D models',
                      items: Schema.object({
                        properties: {
                          mode: Schema.string({
                            description:
                              'Clone mode ("random", "fixed", "single")'
                          }),
                          modelsArray: Schema.string({
                            description: 'Comma-separated list of model names'
                          }),
                          spacing: Schema.number({
                            description: 'Distance between models in meters'
                          }),
                          count: Schema.number({
                            description: 'Number of models (for random mode)'
                          }),
                          facing: Schema.number({
                            description: 'Rotation in degrees'
                          }),
                          randomFacing: Schema.boolean({
                            description: 'Random rotation'
                          }),
                          cycleOffset: Schema.number({
                            description: 'Offset in the repeating pattern (0-1)'
                          })
                        },
                        optionalProperties: [
                          'count',
                          'facing',
                          'randomFacing',
                          'cycleOffset'
                        ]
                      })
                    }),
                    stencil: Schema.array({
                      description: 'Stencil configuration for road markings',
                      items: Schema.object({
                        properties: {
                          modelsArray: Schema.string({
                            description: 'Stencil model names'
                          }),
                          spacing: Schema.number({
                            description: 'Distance between stencils'
                          }),
                          padding: Schema.number({
                            description: 'Edge padding'
                          }),
                          cycleOffset: Schema.number({
                            description: 'Pattern offset (0-1)'
                          }),
                          direction: Schema.string({
                            description: 'Stencil orientation'
                          }),
                          stencilHeight: Schema.number({
                            description: 'Height of stencil'
                          })
                        },
                        optionalProperties: [
                          'padding',
                          'cycleOffset',
                          'direction',
                          'stencilHeight'
                        ]
                      })
                    }),
                    pedestrians: Schema.array({
                      description: 'Pedestrian configuration',
                      items: Schema.object({
                        properties: {
                          density: Schema.string({
                            description:
                              'Pedestrian density ("normal", "dense")'
                          })
                        }
                      })
                    }),
                    striping: Schema.array({
                      description: 'Striping configuration for lane markings',
                      items: Schema.object({
                        properties: {
                          striping: Schema.string({
                            description: 'Stripe pattern type'
                          }),
                          side: Schema.string({
                            description: 'Side of segment ("left", "right")'
                          })
                        },
                        optionalProperties: ['side']
                      })
                    })
                  },
                  optionalProperties: [
                    'clones',
                    'stencil',
                    'pedestrians',
                    'striping'
                  ]
                })
              },
              optionalProperties: ['name', 'generated']
            })
          })
        },
        optionalProperties: ['name', 'length', 'position']
      })
    },
    {
      name: 'managedStreetUpdate',
      description:
        'Update segments in an existing managed street (use entityUpdate for updating street properties)',
      parameters: Schema.object({
        properties: {
          entityId: Schema.string({
            description: 'The ID of the managed street entity to update'
          }),
          operation: Schema.string({
            description:
              'Operation to perform ("add-segment", "update-segment", "remove-segment")'
          }),
          segmentIndex: Schema.number({
            description:
              'Index of the segment to update or remove (for update-segment and remove-segment operations)'
          }),
          segment: Schema.object({
            description:
              'Segment definition for add-segment or update-segment operations',
            properties: {
              name: Schema.string({
                description: 'Display name of the segment'
              }),
              type: Schema.string({
                description:
                  'Type of segment (e.g., "drive-lane", "bike-lane", "sidewalk")'
              }),
              surface: Schema.string({
                description:
                  'Surface material (e.g., "asphalt", "concrete", "grass")'
              }),
              color: Schema.string({
                description: 'Hex color code (e.g., "#ffffff")'
              }),
              level: Schema.number({
                description: 'Vertical offset (-1, 0, 1, 2)'
              }),
              width: Schema.number({
                description: 'Width in meters'
              }),
              direction: Schema.string({
                description: 'Traffic direction ("none", "inbound", "outbound")'
              }),
              generated: Schema.object({
                description: 'Optional generated content',
                properties: {}
              })
            },
            optionalProperties: [
              'name',
              'type',
              'surface',
              'color',
              'level',
              'width',
              'direction',
              'generated'
            ]
          })
        },
        optionalProperties: ['segmentIndex', 'segment']
      })
    }
  ]
};

const AIChatPanel = () => {
  const initialMessage = {
    role: 'assistant',
    content:
      "I am an AI assistant for the 3DStreet application. I can try to help you to analyze the scene, modify the scene or provide help about the 3DStreet editor. But I'm just a hacky experiment, and a lot of stuff is not working yet. What do you need help with?"
  };

  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const chatContainerRef = useRef(null);
  const { currentUser } = useAuthContext();
  const setModal = useStore((state) => state.setModal);

  const modelRef = useRef(null);

  const systemPrompt = `
      You are an AI assistant for the 3DStreet application that helps users analyze and modify 3D scenes. Your name is DadBot.

      ## Core Functions
      1. If the user is asking about the scene, provide a natural language explanation
      2. If the user is asking to modify the scene, use the entityUpdate function
      3. If the user is asking to create or modify a managed street, use the managedStreetCreate or managedStreetUpdate functions
      4. If the user needs help, provide relevant guidance about the 3DStreet editor
      5. If the user provides information about their project, update the appropriate properties in the project-info component on entityId "project"
      6. If you are asking if there is something else you can do, you can offer to tell a dad joke, but maximum once per session.

      IMPORTANT: When the user asks for you to do a command, DO NOT ask clarifying questions before doing the command. Remember the user can always undo the command if they make a mistake or modify something after an initial street, model, segment, etc. is placed. For example if a user wants a street, you could immediately create a default two-way street with bike lanes using the managedStreetCreate function without first asking for details about dimensions, segments, or position - just create the default street.

      In the scene state, units for length are in meters, and rotations are in degrees.

      The orientation of axis to cardinal directions is as follows: 
      - x+ (positive) is north
      - x- (negative) is south
      - y+ (positive) is up
      - y- (negative) is down
      - z- (negative) is west
      - z+ (positive) is east
      
      Models face z+ (east) when at 0º Y rotation. Increasing Y rotation will rotate the model to the left (anticlockwise). Therefore if a model is at 90º Y rotation and a user asks to "move it forward" it will be moving to the north.

      Make sure you convert everything to the appropriate units, even if the user uses different units.

      IMPORTANT: When you need to calculate a value (like "5 - 2"), return it as a string expression ("5 - 2") in a parameter named "expressionForValue"

      When changing a model from one to another, use the "entityupdate" command with the following payload:
      {
        "entityId": "n9eLgB9C635T_edXuXIgz",
        "component": "mixin",
        "value": "fire-truck-rig"
      }

      The possible model (mixin) values are: Bicycle_1, bus, sedan-rig, sedan-taxi-rig, suv-rig, box-truck-rig, food-trailer-rig, fire-truck-rig, fire-ladder-rig, trash-truck-side-loading, self-driving-cruise-car-rig, self-driving-waymo-car, tuk-tuk, motorbike, cyclist-cargo, cyclist1, cyclist2, cyclist3, cyclist-kid, cyclist-dutch, char1, char2, char3, char4, char5, char6, char7, char8, char9, char10, char11, char12, char13, char14, char15, char16, tram, trolley, minibus, dividers-flowers, dividers-planting-strip, dividers-planter-box, dividers-bush, dividers-dome, safehit, bollard, temporary-barricade, temporary-traffic-cone, temporary-jersey-barrier-plastic, temporary-jersey-barrier-concrete, street-element-crosswalk-raised, street-element-traffic-island-end-rounded, street-element-sign-warning-ped-rrfb, street-element-traffic-post-k71, street-element-traffic-island, street-element-speed-hump, crosswalk-zebra-box, traffic-calming-bumps, corner-island, brt-station, outdoor_dining, bench_orientation_center, parklet, utility_pole, lamp-modern, lamp-modern-double, bikerack, bikeshare, lamp-traditional, palm-tree, bench, seawall, track, tree3, bus-stop, bus-stop-alternate, wayfinding, signal_left, signal_right, stop_sign, trash-bin, lending-library, residential-mailbox, USPS-mailbox, picnic-bench, large-parklet, SM3D_Bld_Mixed_Corner_4fl, SM3D_Bld_Mixed_Double_5fl, SM3D_Bld_Mixed_4fl_2, SM3D_Bld_Mixed_5fl, SM3D_Bld_Mixed_4fl, SM_Bld_House_Preset_03_1800, SM_Bld_House_Preset_08_1809, SM_Bld_House_Preset_09_1845, arched-building-01, arched-building-02, arched-building-03, arched-building-04, ElectricScooter_1, Character_1_M, magic-carpet, cyclist-cargo

      When updating a model's position, rotation or scale, use the "entityupdate" command with the following payload:
      {
        "entityId": "n9eLgB9C635T_edXuXIgz",
        "component": "position",
        "property": "x",
        "expressionForValue": "3 + 4"
      }

      EXAMPLE: Moving a car forward 10 feet when it has 90° Y rotation:
      1. From scene state, find car has position "2 0 0" and rotation "0 90 0" 
      2. At 90° Y rotation, "forward" means +x (north)
      3. Convert 10 feet to meters: 10 * 0.3048
      4. Call entityUpdate with:
        {
          "entityId": "NLs5CmxZ8r6nfuAEgPhck",
          "component": "position",
          "property": "x",
          "expressionForValue": "2 + 10 * 0.3048"
        }

      NEVER use expressionForValue with vector strings like "3.048 0 0" - they will fail.
      ALWAYS specify the component (position) AND property (x, y, or z) for movement commands.

      MANAGED STREET TOOLS:
      
      To create a new managed street, use the managedStreetCreate function with a payload like this:
      {
        "name": "Two-way Street with Bike Lanes",
        "length": "60",
        "position": "0 0 0",
        "segments": [
          {
            "type": "sidewalk",
            "width": 3,
            "level": 1,
            "surface": "sidewalk",
            "color": "#cccccc",
            "direction": "none"
          },
          {
            "type": "bike-lane",
            "width": 1.5,
            "level": 0,
            "surface": "asphalt",
            "color": "#88cc88",
            "direction": "inbound"
          },
          {
            "type": "drive-lane",
            "width": 3.5,
            "level": 0,
            "surface": "asphalt",
            "color": "#888888",
            "direction": "inbound"
          },
          {
            "type": "drive-lane",
            "width": 3.5,
            "level": 0,
            "surface": "asphalt",
            "color": "#888888",
            "direction": "outbound"
          },
          {
            "type": "bike-lane",
            "width": 1.5,
            "level": 0,
            "surface": "asphalt",
            "color": "#88cc88",
            "direction": "outbound"
          },
          {
            "type": "sidewalk",
            "width": 3,
            "level": 1,
            "surface": "sidewalk",
            "color": "#cccccc",
            "direction": "none"
          }
        ]
      }
      
      To update properties of an existing managed street (like length), use the entityUpdate function:
      {
        "entityId": "street-123",
        "component": "managed-street",
        "property": "length",
        "value": "100"
      }
      
      To add a new segment to a managed street, use managedStreetUpdate:
      {
        "entityId": "street-123",
        "operation": "add-segment",
        "segmentIndex": 0, // Optional: position to insert the segment (0 = leftmost, omit to add to the right side)
        "segment": {
          "type": "drive-lane",
          "width": 3.5,
          "level": 0,
          "surface": "asphalt",
          "color": "#888888",
          "direction": "inbound"
        }
      }
      
      IMPORTANT SAFETY GUIDELINES:
      1. NEVER place bollards or other protective elements directly ON bike lanes or pedestrian paths.
      2. When adding protection for bike lanes, ALWAYS place bollards or barriers in a divider segment BETWEEN the bike lane and the drive lane.
      3. To properly protect a bike lane, add a narrow divider segment (type: "divider", width: 0.2-0.5) between the bike lane and the adjacent drive lane, then add bollards to that divider segment.
      
      Example of correctly protecting a bike lane with bollards:
      {
        "entityId": "street-123",
        "operation": "add-segment",
        "segmentIndex": 2, // Insert between bike lane (index 1) and drive lane (index 2)
        "segment": {
          "type": "divider",
          "width": 0.3,
          "level": 0.1,
          "surface": "concrete",
          "color": "#888888",
          "direction": "none",
          "generated": {
            "clones": [
              {
                "spacing": 2,
                "modelsArray": "bollard",
                "count": 30,
                "facing": 0,
                "mode": "fixed"
              }
            ]
          }
        }
      }
      
      To update an existing segment, use:
      {
        "entityId": "street-123",
        "operation": "update-segment",
        "segmentIndex": 2,
        "segment": {
          "width": 4.0,
          "color": "#999999"
        }
      }
      
      IMPORTANT: To remove clones or other generated elements from a segment, use an empty array:
      {
        "entityId": "street-123",
        "operation": "update-segment",
        "segmentIndex": 2,
        "segment": {
          "generated": {
            "clones": []
          }
        }
      }
      
      You can also set the property to null, which has the same effect:
      {
        "entityId": "street-123",
        "operation": "update-segment",
        "segmentIndex": 2,
        "segment": {
          "generated": {
            "clones": null
          }
        }
      }
      
      To remove a segment, use:
      {
        "entityId": "street-123",
        "operation": "remove-segment",
        "segmentIndex": 2
      }
      
      ## Project Information
      The scene may contain a project-info component on the "project" entityId that stores information about the current project. When users mention details about their project, you should update this component.
      
      The project-info component has the following fields:
      - location: Colloquial description of project location
      - problemStatement: Description of the problem being addressed
      - currentCondition: Description of the current street conditions
      - proposedSolutions: Description of the proposed solution(s)
      
      To update the project-info component, use the entityUpdate function:
      {
        "entityId": "project",
        "component": "project-info",
        "property": "location",
        "value": "Main Street Corridor Between 123rd and 124th Streets"
      }
      
      You can update any of the project-info properties this way. Always look for opportunities to update the project-info component when users provide relevant information, even if they don't explicitly ask you to update it.

      IMPORTANT: Always respond with a text message, even if the user is asking for a function call.

      You can invoke more than 1 function at a time.

      Most of the time you're polite but serious. Sometimes you can be a little bit more fun and creative. If pressed, your name is actually DadBot. You're a friendly AI assistant that can help you with your 3D scenes. You can also help with other tasks, such as thinking about safe streets, morality of spatial equity, dad jokes, or general moral humanistic quandaries a la Claude from Anthropic. But mostly you're there to help modify 3DStreet scenes.
      `;

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
            maxOutputTokens: 1000
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

  // Hide the chat panel by default when component mounts
  useEffect(() => {
    const container = document.querySelector('.chat-panel-container');
    if (container) container.style.display = 'none';
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
      console.log('Model reference:', modelRef.current);

      const response = result.response;
      const responseText = response.text();

      posthog.capture('$ai_generation', {
        $ai_model: AI_MODEL_ID,
        $ai_provider: 'vertexai',
        $ai_trace_id: AI_CONVERSATION_ID,
        $ai_input: [{ role: 'user', content: prompt }],
        $ai_input_tokens: response.usageMetadata.promptTokenCount,
        $ai_output_choices: [{ role: 'assistant', content: responseText }],
        $ai_output_tokens: response.usageMetadata.candidatesTokenCount
      });

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
            // Validate that the function name exists in the function declarations
            const functionExists = entityTools.functionDeclarations.some(
              (func) => func.name === call.name
            );

            if (!functionExists) {
              throw new Error(
                `Unknown function: ${call.name}. Please use one of the available functions.`
              );
            }
            if (call.name === 'entityUpdate') {
              const args = call.args;

              // Extract fields with appropriate fallbacks
              const entityId = args.entityId;
              const component = args.component;
              const property = args.property || null;

              // Create the command payload
              const payload = {
                entityId: entityId,
                component: component
              };

              // Add property if specified (important for position.x, position.y, etc.)
              if (property) {
                payload.property = property;
              }

              // Set the value - either from direct value or expression
              if (args.expressionForValue) {
                try {
                  // Simple numeric expression evaluation
                  const expr = args.expressionForValue.trim();
                  // Simple safety check - only allow basic math
                  if (!/^[-+0-9\s()*/%.]*$/.test(expr)) {
                    throw new Error(
                      'Invalid expression: contains forbidden characters'
                    );
                  }

                  // Use Function constructor for simple math evaluation
                  // This is safer than eval() but still handles basic arithmetic
                  // payload.value = new Function(`return ${expr}`)();
                  payload.value = evaluateExpression(expr);
                } catch (error) {
                  throw new Error(
                    `Failed to evaluate expression "${args.expressionForValue}": ${error.message}`
                  );
                }
              } else if (args.value) {
                payload.value = args.value;
              } else {
                throw new Error(
                  'Either value or expressionForValue must be provided'
                );
              }

              // Execute the command
              const commandData = {
                command: 'entityupdate',
                payload
              };

              console.log('Executing command:', commandData);
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
            } else if (call.name === 'managedStreetCreate') {
              // Create a new managed street entity with proper structure
              const streetData = {
                name: call.args.name || 'New Managed Street',
                length: parseFloat(call.args.length || '60'),
                segments: []
              };

              // Ensure each segment has all required properties
              if (call.args.segments && Array.isArray(call.args.segments)) {
                streetData.segments = call.args.segments.map((segment) => {
                  // Ensure all required properties are present with defaults if missing
                  return {
                    name:
                      segment.name || `${segment.type || 'segment'} • default`,
                    type: segment.type || 'drive-lane',
                    width:
                      typeof segment.width === 'number' ? segment.width : 3,
                    level:
                      typeof segment.level === 'number' ? segment.level : 0,
                    direction: segment.direction || 'none',
                    color: segment.color || '#888888',
                    surface: segment.surface || 'asphalt',
                    // Include generated content if provided
                    ...(segment.generated
                      ? { generated: segment.generated }
                      : {})
                  };
                });
              }

              // Calculate total width for proper alignment
              const totalWidth = streetData.segments.reduce(
                (sum, segment) => sum + segment.width,
                0
              );
              streetData.width = totalWidth;

              // Generate a unique ID for the new entity
              const uniqueId =
                'managed-street-' + Math.random().toString(36).substr(2, 9);

              // Create the entity definition for AFRAME.INSPECTOR.execute
              const definition = {
                id: uniqueId,
                parent: '#street-container', // This ensures it's added to the street-container
                components: {
                  position: call.args.position || '0 0.01 0', // Default position slightly above ground
                  'managed-street': {
                    sourceType: 'json-blob',
                    sourceValue: JSON.stringify(streetData),
                    showVehicles: true,
                    showStriping: true,
                    synchronize: true
                  },
                  'data-layer-name': streetData.name || 'New Managed Street'
                }
              };

              // Use AFRAME.INSPECTOR.execute to create the entity, which properly integrates with the inspector
              // and ensures all components are initialized correctly
              AFRAME.INSPECTOR.execute('entitycreate', definition);

              // Log the created street data for debugging
              console.log('Created managed street with data:', streetData);

              // Update function call status to success
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'functionCall' && msg.id === functionCallObj.id
                    ? {
                        ...msg,
                        status: 'success',
                        result: 'Managed street created successfully'
                      }
                    : msg
                )
              );
            } else if (call.name === 'managedStreetUpdate') {
              const entityId = call.args.entityId;
              const operation = call.args.operation;
              const entity = document.getElementById(entityId);

              if (!entity) {
                throw new Error(`Entity with ID ${entityId} not found`);
              }

              // Get all segment entities (direct children with street-segment component)
              const segmentEntities = Array.from(entity.children).filter(
                (child) => child.hasAttribute('street-segment')
              );

              if (operation === 'add-segment') {
                // Add a new segment
                const segment = call.args.segment;
                const segmentIndex = call.args.segmentIndex;

                if (!segment || !segment.type) {
                  throw new Error('Segment must have at least a type property');
                }

                // Create a new segment entity
                const segmentEl = document.createElement('a-entity');

                // Set default values for any missing properties
                const segmentData = {
                  type: segment.type,
                  width: typeof segment.width === 'number' ? segment.width : 3,
                  length: entity.components['managed-street'].data.length || 60,
                  level: typeof segment.level === 'number' ? segment.level : 0,
                  direction: segment.direction || 'none',
                  color: segment.color || '#888888',
                  surface: segment.surface || 'asphalt'
                };

                // Set the segment component with properties
                segmentEl.setAttribute('street-segment', segmentData);

                // Set the layer name for the segment
                const layerName = segment.name || `${segment.type} • default`;
                segmentEl.setAttribute('data-layer-name', layerName);

                // Add the segment to the managed street entity at the specified index or at the end if no index
                if (segmentIndex !== undefined) {
                  // Validate the segment index
                  if (
                    segmentIndex < 0 ||
                    segmentIndex > segmentEntities.length
                  ) {
                    throw new Error(
                      `Invalid segmentIndex: ${segmentIndex}. Must be between 0 and ${segmentEntities.length}`
                    );
                  }

                  // If we have a valid index, insert at that position
                  if (segmentIndex < segmentEntities.length) {
                    // Insert before the segment at the specified index
                    entity.insertBefore(
                      segmentEl,
                      segmentEntities[segmentIndex]
                    );
                    console.log(
                      `Added new segment at segmentIndex ${segmentIndex}:`,
                      segmentData
                    );
                  } else {
                    // If the index is equal to the length, append to the end
                    entity.appendChild(segmentEl);
                    console.log(
                      `Added new segment at the end (segmentIndex ${segmentEntities.length}):`,
                      segmentData
                    );
                  }
                } else {
                  // Default behavior: append to the end
                  entity.appendChild(segmentEl);
                  console.log('Added new segment at the end:', segmentData);
                }

                // If segment has generated content, add it after the segment is loaded
                if (segment.generated) {
                  segmentEl.addEventListener('loaded', () => {
                    segmentEl.components[
                      'street-segment'
                    ].generateComponentsFromSegmentObject(segment);
                  });
                }
              } else if (operation === 'update-segment') {
                // Update an existing segment
                const segmentIndex = call.args.segmentIndex;
                const segment = call.args.segment;

                if (segmentIndex === undefined || !segment) {
                  throw new Error(
                    'segmentIndex and segment are required for update-segment operation'
                  );
                }

                if (
                  segmentIndex < 0 ||
                  segmentIndex >= segmentEntities.length
                ) {
                  throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
                }

                // Get the segment entity to update
                const segmentEl = segmentEntities[segmentIndex];

                // Get current segment data
                const currentData = segmentEl.getAttribute('street-segment');

                // Update only the properties that were provided
                const updatedData = { ...currentData };

                // Update properties
                Object.keys(segment).forEach((key) => {
                  if (key !== 'generated') {
                    // Handle generated separately
                    updatedData[key] = segment[key];
                  }
                });

                // Update the street-segment component
                segmentEl.setAttribute('street-segment', updatedData);

                // Update the layer name if provided
                if (segment.name) {
                  segmentEl.setAttribute('data-layer-name', segment.name);
                }

                // If generated content is provided, update it
                if (segment.generated) {
                  // Check if we need to remove any generated components
                  // This handles the case where clones: [] is provided to remove clones
                  const generatedTypes = [
                    'clones',
                    'stencil',
                    'pedestrians',
                    'striping',
                    'rail'
                  ];

                  generatedTypes.forEach((type) => {
                    // If the type exists in segment.generated and is an empty array, remove those components
                    if (
                      Array.isArray(segment.generated[type]) &&
                      segment.generated[type].length === 0
                    ) {
                      // Find all components of this type on the segment
                      Object.keys(segmentEl.components).forEach(
                        (componentName) => {
                          if (
                            componentName.startsWith(`street-generated-${type}`)
                          ) {
                            // Remove the component
                            segmentEl.removeAttribute(componentName);
                            console.log(
                              `Removed ${componentName} from segment at index ${segmentIndex}`
                            );
                          }
                        }
                      );
                    } else if (segment.generated[type] === null) {
                      // If the type is explicitly set to null, also remove those components
                      // Find all components of this type on the segment
                      Object.keys(segmentEl.components).forEach(
                        (componentName) => {
                          if (
                            componentName.startsWith(`street-generated-${type}`)
                          ) {
                            // Remove the component
                            segmentEl.removeAttribute(componentName);
                            console.log(
                              `Removed ${componentName} from segment at index ${segmentIndex}`
                            );
                          }
                        }
                      );
                    }
                  });

                  // Only call generateComponentsFromSegmentObject if there are non-empty arrays
                  // or if the generated object has properties other than those we explicitly handled
                  const hasNonEmptyArrays = generatedTypes.some(
                    (type) =>
                      Array.isArray(segment.generated[type]) &&
                      segment.generated[type].length > 0
                  );

                  const hasOtherProperties = Object.keys(
                    segment.generated
                  ).some((key) => !generatedTypes.includes(key));

                  if (hasNonEmptyArrays || hasOtherProperties) {
                    // We need to wait for the next tick to ensure the segment component is updated
                    setTimeout(() => {
                      segmentEl.components[
                        'street-segment'
                      ].generateComponentsFromSegmentObject({
                        ...updatedData,
                        generated: segment.generated
                      });
                    }, 0);
                  }
                }

                console.log(
                  'Updated segment at segmentIndex',
                  segmentIndex,
                  'with data:',
                  updatedData
                );
              } else if (operation === 'remove-segment') {
                // Remove a segment
                const segmentIndex = call.args.segmentIndex;

                if (segmentIndex === undefined) {
                  throw new Error(
                    'segmentIndex is required for remove-segment operation'
                  );
                }

                if (
                  segmentIndex < 0 ||
                  segmentIndex >= segmentEntities.length
                ) {
                  throw new Error(`Invalid segmentIndex: ${segmentIndex}`);
                }

                // Get the segment entity to remove
                const segmentEl = segmentEntities[segmentIndex];

                // Remove the segment from the parent
                entity.removeChild(segmentEl);

                console.log('Removed segment at segmentIndex', segmentIndex);
              } else if (call.name === 'projectInfoUpdate') {
                // Handle project info update
                const args = call.args;

                // Get the project info entity
                let projectInfoEntity = document.querySelector(
                  '#project-info-entity'
                );

                // If the entity doesn't exist, create it
                if (!projectInfoEntity) {
                  console.log('Creating project info entity');
                  projectInfoEntity = document.createElement('a-entity');
                  projectInfoEntity.setAttribute('id', 'project-info-entity');
                  projectInfoEntity.setAttribute('project-info', {});

                  // Add to the scene under user layers
                  const userLayers =
                    document.querySelector('#user-layers') ||
                    document.querySelector('a-scene');
                  userLayers.appendChild(projectInfoEntity);
                }

                // Update the project info properties
                for (const key in args) {
                  if (args[key]) {
                    projectInfoEntity.setAttribute(
                      'project-info',
                      key,
                      args[key]
                    );
                  }
                }

                // Update function call status to success
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.type === 'functionCall' && msg.id === functionCallObj.id
                      ? {
                          ...msg,
                          status: 'success',
                          result: 'Project info updated successfully'
                        }
                      : msg
                  )
                );
              } else {
                throw new Error(`Unknown operation: ${operation}`);
              }

              // Trigger a refresh of the managed street
              // This will update the alignment and other properties
              AFRAME.INSPECTOR.execute('entityupdate', {
                entity: entity,
                component: 'street-align',
                property: 'refresh',
                value: true
              });

              console.log('Updated managed street entity:', entityId);

              // Update function call status to success
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.type === 'functionCall' && msg.id === functionCallObj.id
                    ? {
                        ...msg,
                        status: 'success',
                        result: 'Managed street updated successfully'
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
        console.log('Vertex AI chat reinitialized successfully');
      } catch (error) {
        console.error('Error reinitializing Vertex AI:', error);
      }
    };

    initializeAI();
  };

  return (
    <div className="chat-panel-container">
      <Collapsible defaultCollapsed={true}>
        <div className="panel-header">
          <span>AI Scene Assistant (Experimental)</span>
          <button
            className="close-button"
            onClick={(e) => {
              e.stopPropagation();
              const container = document.querySelector('.chat-panel-container');
              if (container) container.style.display = 'none';
            }}
            title="Close AI Assistant"
          >
            ×
          </button>
        </div>
        <div
          className={`chat-panel ${!currentUser?.isPro ? styles.proFeaturesWrapper : ''}`}
        >
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
          <div ref={chatContainerRef} className="chat-messages">
            {messages.map((message, index) =>
              message.type === 'functionCall' ? (
                <FunctionCallMessage key={message.id} functionCall={message} />
              ) : (
                <div key={index} className={`chat-message ${message.role}`}>
                  {message.role === 'assistant' && index === 0 && (
                    <div className="assistant-avatar">
                      <img
                        src="../../../ui_assets/cards/icons/dadbot.jpg"
                        alt="AI Assistant"
                      />
                    </div>
                  )}
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
              onKeyPress={(e) =>
                e.key === 'Enter' && currentUser?.isPro && handleSendMessage()
              }
              placeholder="Ask about the scene..."
              disabled={!currentUser?.isPro}
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !currentUser?.isPro}
            >
              Send
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="reset-button"
              title="Reset conversation"
              disabled={!currentUser?.isPro}
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
