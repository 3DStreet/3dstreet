import { getGenerativeModel } from 'firebase/vertexai';
import { vertexAI } from '../services/firebase.js';

class AIChatService {
  constructor(firebaseApp) {
    this.model = null;
    this.initPromise = this.initialize(firebaseApp);
  }

  async initialize(firebaseApp) {
    try {
      this.model = getGenerativeModel(vertexAI, {
        model: 'gemini-1.5-flash'
      });
    } catch (error) {
      console.error('Error initializing AI Chat Service:', error);
      throw error;
    }
  }

  async generateResponse(prompt, sceneState) {
    if (!this.model) {
      throw new Error('AI model not initialized');
    }

    const formattedPrompt = this.formatPrompt(prompt, sceneState);
    const result = await this.model.generateContent(formattedPrompt);
    return result.response.text();
  }

  formatPrompt(userInput, sceneState) {
    return `
      Context: You are a 3D street scene assistant for the 3DStreet application. 
      The current scene has the following state:
      ${JSON.stringify(sceneState, null, 2)}

      User request: ${userInput}

      Please analyze the request and provide one of the following:
      1. If the user is asking to modify the scene, provide specific JSON-formatted changes
      2. If the user is asking about the scene, provide a natural language explanation
      3. If the user needs help, provide relevant guidance about the 3DStreet editor

      For scene modifications, use this JSON format:
      {
        "action": "modify_scene",
        "changes": [
          {
            "type": "add"|"remove"|"update",
            "element": "<element_type>",
            "properties": {}
          }
        ]
      }
    `;
  }

  parseResponse(response) {
    try {
      // Check if the response is JSON
      const parsed = JSON.parse(response);
      if (parsed.action === 'modify_scene') {
        return {
          type: 'scene_modification',
          data: parsed.changes
        };
      }
      return {
        type: 'text',
        data: response
      };
    } catch (e) {
      // If not JSON, treat as regular text response
      return {
        type: 'text',
        data: response
      };
    }
  }
}

export default AIChatService;
