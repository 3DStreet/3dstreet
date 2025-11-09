import { getGenerativeModel } from 'firebase/vertexai';
import { vertexAI } from '@shared/services/firebase.js';

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
