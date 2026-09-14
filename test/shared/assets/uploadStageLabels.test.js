import { describe, it, expect } from 'vitest';
import {
  getUploadStageLabel,
  isUploadStage,
  UPLOAD_STAGE_MESSAGE_IDS
} from '../../../src/shared/assets/uploadStageLabels.js';
import { formatSharedMessage } from '../../../src/shared/i18n/sharedMessages.js';

const t = (id, values) => formatSharedMessage(id, values, { locale: 'en' });

describe('getUploadStageLabel', () => {
  it('covers every stage the upload pipeline writes', () => {
    for (const status of [
      'validating',
      'optimizing',
      'uploading',
      'thumbnailing',
      'finishing'
    ]) {
      expect(isUploadStage(status)).toBe(true);
      expect(getUploadStageLabel(t, status)).toBeTruthy();
    }
  });

  it('never says Uploading before bytes move', () => {
    expect(getUploadStageLabel(t, 'validating')).toBe('Preparing…');
    expect(getUploadStageLabel(t, 'optimizing')).toBe('Optimizing…');
  });

  it('shows the percentage only while uploading and only above zero', () => {
    expect(getUploadStageLabel(t, 'uploading', 0)).toBe('Uploading…');
    expect(getUploadStageLabel(t, 'uploading', 42.4)).toBe('Uploading 42%');
    expect(getUploadStageLabel(t, 'finishing', 100)).toBe('Finishing…');
  });

  it('reads Finishing on both post-doc stages so surfaces agree', () => {
    expect(getUploadStageLabel(t, 'thumbnailing')).toBe(
      getUploadStageLabel(t, 'finishing')
    );
  });

  it('returns null for non-stage statuses', () => {
    expect(isUploadStage('uploaded')).toBe(false);
    expect(getUploadStageLabel(t, 'uploaded')).toBeNull();
    expect(getUploadStageLabel(t, 'failed')).toBeNull();
  });

  it('maps every stage to a message id that exists', () => {
    for (const id of Object.values(UPLOAD_STAGE_MESSAGE_IDS)) {
      expect(t(id)).not.toBe(id);
    }
    expect(t('uploadStageUploadingPct', { pct: 7 })).not.toBe(
      'uploadStageUploadingPct'
    );
  });
});
