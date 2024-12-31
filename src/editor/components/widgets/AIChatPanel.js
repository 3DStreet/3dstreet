import { useState, useEffect, useRef } from 'react';
import { vertexAI } from '../../services/firebase.js';
import { getGenerativeModel } from 'firebase/vertexai';
import Collapsible from '../Collapsible';

const AIChatPanel = ({ scene }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatContainerRef = useRef(null);
  const modelRef = useRef(null);

  useEffect(() => {
    console.log('AIChatPanel mounted');
    console.log('Scene available:', !!scene);
    const initializeAI = async () => {
      try {
        console.log('Initializing Vertex AI');
        modelRef.current = getGenerativeModel(vertexAI, {
          model: 'gemini-1.5-flash'
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

    try {
      // Get the current scene state
      const sceneState = scene.current
        ? scene.current.getAttribute('managed-street')
        : null;

      const prompt = `
        Context: You are a 3D street scene assistant. The current scene has the following state:
        ${JSON.stringify(sceneState, null, 2)}

        User request: ${input}

        Please provide suggestions for modifying the scene. Format your response as JSON when suggesting specific changes.
      `;

      const result = await modelRef.current.generateContent(prompt);
      const response = await result.response;
      const aiMessage = { role: 'assistant', content: response.text() };

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
                {message.content}
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
