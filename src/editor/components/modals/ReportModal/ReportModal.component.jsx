import { useState } from 'react';
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

    // Log form data to console
    console.log('Generating report with the following data:', formData);

    // Simulate API call
    setTimeout(() => {
      setIsGenerating(false);
      onClose();
    }, 1000);
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
