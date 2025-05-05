import { useState, useEffect } from 'react';
import Modal from '../Modal.jsx';
import useStore from '@/store.js';
import styles from './ReportModal.module.scss';
import { Button, TextArea, Input } from '@/editor/components/components';
import { useAuthContext } from '@/editor/contexts';
import { GeospatialIcon } from '@/editor/icons';

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
  const [hasGeoLocation, setHasGeoLocation] = useState(false);
  const [geoCoordinates, setGeoCoordinates] = useState('');
  const [previousModal, setPreviousModal] = useState(null);

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

      // Check if geo location is defined
      const geoLayer = document.getElementById('reference-layers');
      if (geoLayer && geoLayer.hasAttribute('street-geo')) {
        const streetGeo = geoLayer.getAttribute('street-geo');
        if (streetGeo && streetGeo.latitude && streetGeo.longitude) {
          setHasGeoLocation(true);
          setGeoCoordinates(`${streetGeo.latitude}, ${streetGeo.longitude}`);
        } else {
          setHasGeoLocation(false);
          setGeoCoordinates('');
        }
      } else {
        setHasGeoLocation(false);
        setGeoCoordinates('');
      }

      // Store that we came from the report modal
      setPreviousModal('report');
    }
  }, [isOpen]);

  // Listen for modal changes to handle returning from geo modal
  useEffect(() => {
    if (previousModal === 'geo' && isOpen) {
      // We've returned from the geo modal to the report modal
      const geoLayer = document.getElementById('reference-layers');
      if (geoLayer && geoLayer.hasAttribute('street-geo')) {
        const streetGeo = geoLayer.getAttribute('street-geo');
        if (streetGeo && streetGeo.latitude && streetGeo.longitude) {
          setHasGeoLocation(true);
          setGeoCoordinates(`${streetGeo.latitude}, ${streetGeo.longitude}`);
        } else {
          setHasGeoLocation(false);
          setGeoCoordinates('');
        }
      }
      setPreviousModal(null);
    }
  }, [isOpen, previousModal]);

  const onClose = () => {
    setModal(null);
  };

  const openGeoModal = () => {
    // Store current modal to return to after geo modal
    setPreviousModal('geo');
    setModal('geo');
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
    const reportPrompt = `Create a report for a street improvement project using the information from the user-provided project description inside of project-info component of #memory entity, and the scene graph.
    Please expand upon project-info description given your understanding of modern transportation planning.
    Optional, generate one or more screenshots using the takeSnapshot function call. Do NOT update memory project-info component when writing the report.
        
    Project Description: ${formData.description}
    Location: ${formData.location}
    Current Conditions: ${formData.currentCondition}
    Problem Statement: ${formData.problemStatement}
    Proposed Solutions: ${formData.proposedSolutions}
    
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
    <Modal
      id="report-modal"
      isOpen={isOpen}
      onClose={onClose}
      title="Generate New Report"
    >
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
            <div className={styles.locationContainer}>
              <Button
                variant="toolbtn"
                onClick={openGeoModal}
                className={styles.geoButton}
                style={!hasGeoLocation ? { backgroundColor: '#8965EF' } : {}}
                title={
                  hasGeoLocation ? 'Edit map location' : 'Set map location'
                }
              >
                <GeospatialIcon
                  className={hasGeoLocation ? styles.activeGeoIcon : ''}
                />
                {hasGeoLocation ? 'Change Location' : 'Set Location'}
              </Button>
              <Input
                id="latlon"
                name="latlon"
                value={geoCoordinates}
                placeholder="Latitude and Longitude"
                readOnly={true}
                disabled={true}
              />
            </div>
            <div className={styles.locationContainer}>
              <Input
                id="location"
                name="location"
                value={formData.location}
                onChange={(value) => handleInputChange(value, 'location')}
                placeholder="Brief description of project location"
              />
            </div>
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
            <label htmlFor="proposedSolutions">Proposed Solution(s)</label>
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
