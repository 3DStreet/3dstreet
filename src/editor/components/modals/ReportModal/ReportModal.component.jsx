import { useState, useEffect } from 'react';
import Modal from '../Modal.jsx';
import useStore from '@/store.js';
import styles from './ReportModal.module.scss';
import { Button, TextArea, Input } from '@/editor/components/components';
import { useAuthContext } from '@/editor/contexts';

export const ReportModal = () => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'report');
  // Auth context available if needed in the future
  useAuthContext();

  const [formData, setFormData] = useState({
    description: '',
    location: '',
    currentCondition: '',
    problemStatement: '',
    proposedSolutions: ''
  });

  const [isGenerating, setIsGenerating] = useState(false);

  // Load project info data from #memory entity when modal opens
  useEffect(() => {
    if (isOpen) {
      const memoryEntity = document.getElementById('memory');
      if (memoryEntity && memoryEntity.hasAttribute('project-info')) {
        const projectInfo = memoryEntity.getAttribute('project-info');
        setFormData({
          description: projectInfo.description || '',
          location: projectInfo.location || '',
          currentCondition: projectInfo.currentCondition || '',
          problemStatement: projectInfo.problemStatement || '',
          proposedSolutions: projectInfo.proposedSolutions || ''
        });
      }
    }
  }, [isOpen]);

  const onClose = () => {
    setModal(null);
  };

  const handleInputChange = (valueOrEvent, name) => {
    // Handle both direct value (from Input) and event objects (from TextArea)
    if (typeof valueOrEvent === 'object' && valueOrEvent.target) {
      // It's an event from TextArea
      const { name: fieldName, value } = valueOrEvent.target;
      setFormData((prev) => ({
        ...prev,
        [fieldName]: value
      }));
    } else {
      // It's a direct value from Input
      setFormData((prev) => ({
        ...prev,
        [name]: valueOrEvent
      }));
    }
  };

  const generateReport = () => {
    setIsGenerating(true);

    // Update project-info component on #memory entity
    const memoryEntity = document.getElementById('memory');
    if (memoryEntity) {
      // Check if component exists and update or add as needed
      if (memoryEntity.hasAttribute('project-info')) {
        AFRAME.INSPECTOR.execute('entityupdate', {
          entity: memoryEntity,
          component: 'project-info',
          value: {
            description: formData.description,
            location: formData.location,
            currentCondition: formData.currentCondition,
            problemStatement: formData.problemStatement,
            proposedSolutions: formData.proposedSolutions
          }
        });
      } else {
        AFRAME.INSPECTOR.execute('componentadd', {
          entity: memoryEntity,
          component: 'project-info',
          value: {
            description: formData.description,
            location: formData.location,
            currentCondition: formData.currentCondition,
            problemStatement: formData.problemStatement,
            proposedSolutions: formData.proposedSolutions
          }
        });
      }

      // Select the entity to update the inspector panel
      setTimeout(() => {
        AFRAME.INSPECTOR.selectEntity(memoryEntity);
      }, 0);
    }

    // Create a report prompt to send to the LLM
    const reportPrompt = `Create a report (also called a study) for a street improvement project using the information from the project description and scene graph.
    Please expand upon information from the description as given your understanding of modern transportation planning, using your knowledge of best practices combined with information from the scene and the user to create a plausible street improvement project.
    Do not respond with affirmation message, since the output of your next message will be copied by the user as the entire report.
    
    Project Description: ${formData.description}
    Location: ${formData.location}
    Current Conditions: ${formData.currentCondition}
    Problem Statement: ${formData.problemStatement}
    Proposed Solutions: ${formData.proposedSolutions}
    
    Optional, generate a screenshot using the takeSnapshot function call. 
    `;

    // Show the AI Chat Panel
    const chatPanelContainer = document.querySelector('.chat-panel-container');
    if (chatPanelContainer) {
      chatPanelContainer.style.display = 'block';

      // Make sure the collapsible is expanded
      const collapsibleContent = chatPanelContainer.querySelector(
        '.collapsible__content'
      );
      if (collapsibleContent && collapsibleContent.style.display === 'none') {
        const collapsibleHeader = chatPanelContainer.querySelector(
          '.collapsible__header'
        );
        if (collapsibleHeader) {
          collapsibleHeader.click();
        }
      }

      // Find the input field and send button
      const inputField = chatPanelContainer.querySelector('input[type="text"]');
      const sendButton = chatPanelContainer.querySelector('.chat-input button');

      if (inputField && sendButton) {
        // Set the input value to our report prompt
        inputField.value = reportPrompt;

        // Trigger the input event to ensure React state is updated
        const inputEvent = new Event('input', { bubbles: true });
        inputField.dispatchEvent(inputEvent);

        // Click the send button to submit the prompt
        setTimeout(() => {
          sendButton.click();
          setIsGenerating(false);
          onClose();
        }, 100);
      } else {
        console.error(
          'Could not find input field or send button in AI Chat Panel'
        );
        setIsGenerating(false);
        onClose();
      }
    } else {
      console.error('Could not find AI Chat Panel container');
      setIsGenerating(false);
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Generate New Report">
      <div className={styles.wrapper}>
        <div className={styles.formContainer}>
          <div className={styles.field}>
            <label htmlFor="description">Project Description</label>
            <Input
              id="description"
              name="description"
              value={formData.description}
              onChange={(value) => handleInputChange(value, 'description')}
              placeholder="Brief description of the project"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="location">Location</label>
            <Input
              id="location"
              name="location"
              value={formData.location}
              onChange={(value) => handleInputChange(value, 'location')}
              placeholder="Street address or intersection"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="currentCondition">Current Conditions</label>
            <TextArea
              id="currentCondition"
              name="currentCondition"
              value={formData.currentCondition}
              onChange={handleInputChange}
              placeholder="Describe the current state of the street"
              rows={3}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="problemStatement">Problem Statement</label>
            <TextArea
              id="problemStatement"
              name="problemStatement"
              value={formData.problemStatement}
              onChange={handleInputChange}
              placeholder="What issues need to be addressed?"
              rows={3}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="proposedSolutions">Proposed Solutions</label>
            <TextArea
              id="proposedSolutions"
              name="proposedSolutions"
              value={formData.proposedSolutions}
              onChange={handleInputChange}
              placeholder="What improvements do you suggest?"
              rows={3}
            />
          </div>

          <div className={styles.actions}>
            <Button onClick={onClose} variant="secondary">
              Cancel
            </Button>
            <Button
              onClick={generateReport}
              disabled={isGenerating}
              loading={isGenerating}
            >
              {isGenerating ? 'Generating...' : 'Generate Report'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
