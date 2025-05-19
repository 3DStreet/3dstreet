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
  const projectInfo = useStore((state) => state.projectInfo);
  const setProjectInfo = useStore((state) => state.setProjectInfo);
  // Auth context available if needed in the future
  useAuthContext();

  const [formData, setFormData] = useState({
    description: '',
    location: '',
    currentCondition: '',
    problemStatement: '',
    proposedSolutions: ''
  });

  const [errors, setErrors] = useState({
    description: '',
    problemStatement: '',
    geoLocation: ''
  });

  const [touched, setTouched] = useState({
    description: false,
    problemStatement: false,
    geoLocation: false
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGeoLocation, setHasGeoLocation] = useState(false);
  const [geoCoordinates, setGeoCoordinates] = useState('');

  // Reset validation state when modal opens/closes
  useEffect(() => {
    // Reset validation errors and touched state when modal closes
    if (!isOpen) {
      // Reset errors - create empty object with same keys
      setErrors((prevErrors) => {
        const resetErrors = {};
        Object.keys(prevErrors).forEach((key) => {
          resetErrors[key] = '';
        });
        return resetErrors;
      });

      // Reset touched state - create object with same keys but all false
      setTouched((prevTouched) => {
        const resetTouched = {};
        Object.keys(prevTouched).forEach((key) => {
          resetTouched[key] = false;
        });
        return resetTouched;
      });
    }

    // Load project info data from Zustand store when modal opens
    if (isOpen) {
      setFormData({
        description: projectInfo.description || '',
        location: projectInfo.projectArea || '',
        currentCondition: projectInfo.currentCondition || '',
        problemStatement: projectInfo.problemStatement || '',
        proposedSolutions: projectInfo.proposedSolutions || ''
      });

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
    }
  }, [isOpen]);

  // Listen for modal changes to handle returning from geo modal
  useEffect(() => {
    if (isOpen) {
      const geoLayer = document.getElementById('reference-layers');
      if (geoLayer && geoLayer.hasAttribute('street-geo')) {
        const streetGeo = geoLayer.getAttribute('street-geo');
        if (streetGeo && streetGeo.latitude && streetGeo.longitude) {
          setHasGeoLocation(true);
          setGeoCoordinates(`${streetGeo.latitude}, ${streetGeo.longitude}`);
          // Clear geo location error
          setErrors((prev) => ({
            ...prev,
            geoLocation: ''
          }));
        } else {
          setHasGeoLocation(false);
          setGeoCoordinates('');
        }
      }
    }
  }, [isOpen]);

  const onClose = () => {
    setModal(null);
  };

  const saveFormData = () => {
    // Update project info in Zustand store
    setProjectInfo({
      description: formData.description,
      projectArea: formData.location,
      currentCondition: formData.currentCondition,
      problemStatement: formData.problemStatement,
      proposedSolutions: formData.proposedSolutions
    });
  };

  const openGeoModal = () => {
    // Save form data without validation before opening geo modal
    saveFormData();

    setModal('geo', true);

    // Mark geoLocation as touched
    setTouched((prev) => ({
      ...prev,
      geoLocation: true
    }));
  };

  const handleInputChange = (valueOrEvent, name) => {
    // Handle both direct value (from Input) and event objects (from TextArea)
    let fieldName, value;

    if (typeof valueOrEvent === 'object' && valueOrEvent.target) {
      // It's an event from TextArea
      fieldName = valueOrEvent.target.name;
      value = valueOrEvent.target.value;
      setFormData((prev) => ({
        ...prev,
        [fieldName]: value
      }));
    } else {
      // It's a direct value from Input
      fieldName = name;
      value = valueOrEvent;
      setFormData((prev) => ({
        ...prev,
        [fieldName]: value
      }));
    }

    // Mark field as touched
    if (fieldName === 'description' || fieldName === 'problemStatement') {
      setTouched((prev) => ({
        ...prev,
        [fieldName]: true
      }));

      // Clear error if value is not empty
      if (value.trim()) {
        setErrors((prev) => ({
          ...prev,
          [fieldName]: ''
        }));
      }
    }
  };

  // Validate form before generating report
  const validateForm = () => {
    const newErrors = {};
    let isValid = true;

    // Validate description
    if (!formData.description.trim()) {
      newErrors.description = 'Project description is required';
      isValid = false;
    }

    // Validate problem statement
    if (!formData.problemStatement.trim()) {
      newErrors.problemStatement = 'Problem statement is required';
      isValid = false;
    }

    // Validate geo location
    if (!hasGeoLocation) {
      newErrors.geoLocation = 'Geographic location is required';
      isValid = false;
    }

    // Update all fields as touched
    setTouched({
      description: true,
      problemStatement: true,
      geoLocation: true
    });

    setErrors(newErrors);
    return isValid;
  };

  const generateReport = () => {
    // Validate form before proceeding
    if (!validateForm()) {
      return;
    }
    setIsGenerating(true);

    // Save form data
    saveFormData();

    // Create a report prompt to send to the LLM
    const reportPrompt = `Create a report for a street improvement project using the information from the user-provided project description in the project info data, and the scene graph.
    Please expand upon the project description given your understanding of modern transportation planning.
    Optional, generate one or more screenshots using the takeSnapshot function call.
        
    Project Description: ${formData.description}
    Project Area: ${formData.location}
    Current Conditions: ${formData.currentCondition}
    Problem Statement: ${formData.problemStatement}
    Proposed Solutions: ${formData.proposedSolutions}

    Be sure to use markdown formatting such as 

    # Project Name
    ## Section Header
    ### Subsection Header
    **Bold Text**
    *Italic Text*
    
    `;

    // Get reference to the AIChatPanel component
    const aiChatPanelRef = window.aiChatPanelRef;

    if (aiChatPanelRef) {
      // Use the exposed API methods to interact with the AIChatPanel
      aiChatPanelRef.openPanel();
      aiChatPanelRef.setUserMessage(reportPrompt);

      // Pass the report prompt directly to submitUserMessage to avoid React state timing issues
      aiChatPanelRef.submitUserMessage(reportPrompt);
      setIsGenerating(false);
      onClose();
    } else {
      console.error('Could not find AI Chat Panel reference');
      setIsGenerating(false);
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
            <div className={styles.labelContainer}>
              <label htmlFor="description" className={styles.requiredField}>
                Project Description
              </label>
              {touched.description && errors.description && (
                <span className={styles.inlineError}>Required</span>
              )}
            </div>
            <Input
              id="description"
              name="description"
              value={formData.description}
              onChange={(value) => handleInputChange(value, 'description')}
              placeholder="Brief description of the project"
            />
          </div>

          <div className={styles.field}>
            <div className={styles.labelContainer}>
              <label htmlFor="location" className={styles.requiredField}>
                Location
              </label>
              {touched.geoLocation && errors.geoLocation && (
                <span className={styles.inlineError}>Required</span>
              )}
            </div>
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
              rows={2}
            />
          </div>

          <div className={styles.field}>
            <div className={styles.labelContainer}>
              <label
                htmlFor="problemStatement"
                className={styles.requiredField}
              >
                Problem Statement
              </label>
              {touched.problemStatement && errors.problemStatement && (
                <span className={styles.inlineError}>Required</span>
              )}
            </div>
            <TextArea
              id="problemStatement"
              name="problemStatement"
              value={formData.problemStatement}
              onChange={handleInputChange}
              placeholder="What issues need to be addressed?"
              rows={2}
              className={
                touched.problemStatement && errors.problemStatement
                  ? styles.errorTextArea
                  : ''
              }
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
              rows={2}
            />
          </div>

          <div className={styles.actions}>
            <Button onClick={onClose} variant="secondary">
              Discard
            </Button>
            <div className={styles.rightActions}>
              <Button
                onClick={() => {
                  saveFormData();
                  onClose();
                }}
                variant="secondary"
              >
                Save Project Info Only
              </Button>
              <Button
                onClick={generateReport}
                disabled={isGenerating}
                loading={isGenerating}
              >
                {isGenerating ? 'Generating...' : 'Save and Generate Report'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
