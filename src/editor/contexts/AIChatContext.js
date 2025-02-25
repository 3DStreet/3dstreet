import { createContext, useContext, useState, useCallback } from 'react';
import AIChatService from '../services/aiChatService';

const AIChatContext = createContext(null);

export const AIChatProvider = ({ children, firebaseApp }) => {
  const [chatService] = useState(() => new AIChatService(firebaseApp));
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const sendMessage = useCallback(
    async (message, sceneState) => {
      setIsProcessing(true);
      try {
        const response = await chatService.generateResponse(
          message,
          sceneState
        );
        const parsedResponse = chatService.parseResponse(response);

        setMessages((prev) => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: response, parsed: parsedResponse }
        ]);

        return parsedResponse;
      } catch (error) {
        console.error('Error in chat:', error);
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: message },
          {
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.'
          }
        ]);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [chatService]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <AIChatContext.Provider
      value={{
        messages,
        isProcessing,
        sendMessage,
        clearMessages
      }}
    >
      {children}
    </AIChatContext.Provider>
  );
};

export const useAIChat = () => {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error('useAIChat must be used within an AIChatProvider');
  }
  return context;
};

export default AIChatContext;
