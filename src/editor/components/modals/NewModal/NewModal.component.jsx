import React from 'react';
import Modal from '@shared/components/Modal/Modal.jsx';
import useStore from '@/store.js';
import styles from './NewModal.module.scss';
import { createBlankScene, inputStreetmix } from '@/editor/lib/SceneUtils.js';
import { Button } from '@/editor/components/elements';
import {
  Upload24Icon,
  ChatbotIcon,
  GeospatialIcon,
  ManagedStreetIcon
} from '@shared/icons';
import {
  createIntersection,
  createManagedStreetFromStreetObject
} from '@/editor/components/elements/AddLayerPanel/createLayerFunctions.js';
import { stroad60ftROW } from '@/editor/components/elements/AddLayerPanel/defaultStreets.js';
import posthog from 'posthog-js';

export const NewModal = () => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'new');
  const saveScene = useStore((state) => state.saveScene);

  React.useEffect(() => {
    if (isOpen) {
      // Track when New Modal is opened
      posthog.capture('new_modal_opened', {
        from_blank_scene: !STREET.utils.getCurrentSceneId(),
        timestamp: new Date().toISOString()
      });
    }
  }, [isOpen]);

  const onClose = () => {
    setModal(null);
  };

  const handleActionClick = (actionType, actionData) => {
    // Track template selection
    posthog.capture('new_modal_template_selected', {
      template_type: actionType,
      template_title: actionData.title,
      had_existing_scene: !!STREET.utils.getCurrentSceneId(),
      timestamp: new Date().toISOString()
    });

    onClose();

    switch (actionType) {
      case 'blank':
        AFRAME.scenes[0].addEventListener(
          'newScene',
          () => {
            saveScene(true);
            posthog.capture('scene_created_from_template', {
              template_type: 'blank',
              timestamp: new Date().toISOString()
            });
          },
          { once: true }
        );
        createBlankScene();
        break;

      case 'basic_street':
        AFRAME.scenes[0].addEventListener(
          'newScene',
          () => {
            // Create managed street with default 60ft ROW
            createManagedStreetFromStreetObject('0 0 0', stroad60ftROW);
            // Save after creating the street
            setTimeout(() => {
              saveScene(true);
            }, 100);
            posthog.capture('scene_created_from_template', {
              template_type: 'basic_street',
              street_template: '60ft_ROW',
              timestamp: new Date().toISOString()
            });
          },
          { once: true }
        );
        createBlankScene();
        break;

      case 'streetmix':
        AFRAME.scenes[0].addEventListener(
          'newScene',
          () => {
            saveScene(true);
            posthog.capture('scene_created_from_template', {
              template_type: 'streetmix_import',
              timestamp: new Date().toISOString()
            });
          },
          { once: true }
        );
        inputStreetmix();
        break;

      case 'geolocation':
        AFRAME.scenes[0].addEventListener(
          'newScene',
          () => {
            saveScene(true);
            // Open geo modal after scene is created
            setTimeout(() => setModal('geo'), 100);
            posthog.capture('scene_created_from_template', {
              template_type: 'geolocation',
              timestamp: new Date().toISOString()
            });
          },
          { once: true }
        );
        createBlankScene();
        break;

      case 'intersection':
        AFRAME.scenes[0].addEventListener(
          'newScene',
          () => {
            createIntersection('0 0 0');
            // Save after creating the intersection
            setTimeout(() => {
              saveScene(true);
            }, 100);
            posthog.capture('scene_created_from_template', {
              template_type: 'intersection',
              intersection_type: '90_degree',
              timestamp: new Date().toISOString()
            });
          },
          { once: true }
        );
        createBlankScene();
        break;

      case 'ar_panorama':
        AFRAME.scenes[0].addEventListener(
          'newScene',
          () => {
            // Create a sphere with panorama texture
            const definition = {
              element: 'a-entity',
              components: {
                geometry:
                  'primitive: sphere; radius: 100; segmentsWidth: 64; segmentsHeight: 32',
                material:
                  'shader: flat; side: back; src: https://kfarr.github.io/ar-tour-assets/panoramic/world_b5da22ec-c745-40b3-ac6b-01247b8c212b_skybox.png',
                scale: '-1 1 1',
                'data-layer-name': 'Sphere Geometry • 360° Panorama'
              }
            };
            AFRAME.INSPECTOR.execute('entitycreate', definition);
            // Save after creating the panorama sphere
            setTimeout(() => {
              saveScene(true);
            }, 100);
            posthog.capture('scene_created_from_template', {
              template_type: 'ar_panorama',
              panorama_source: 'default_skybox',
              timestamp: new Date().toISOString()
            });
          },
          { once: true }
        );
        createBlankScene();
        break;

      case 'ai_assistant':
        AFRAME.scenes[0].addEventListener(
          'newScene',
          () => {
            saveScene(true);
            // Open AI chat panel using the global ref
            setTimeout(() => {
              if (window.aiChatPanelRef && window.aiChatPanelRef.openPanel) {
                window.aiChatPanelRef.openPanel();
              }
            }, 100);
            posthog.capture('scene_created_from_template', {
              template_type: 'ai_assistant',
              ai_panel_opened: true,
              timestamp: new Date().toISOString()
            });
          },
          { once: true }
        );
        createBlankScene();
        break;

      case 'mobile_measurement': {
        posthog.capture('mobile_measurement_opened', {
          timestamp: new Date().toISOString()
        });
        // Show modal with QR code
        const modal = document.createElement('div');
        modal.innerHTML = `
          <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                      background: white; padding: 30px; border-radius: 8px; 
                      box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index: 10000; 
                      text-align: center; max-width: 400px;">
            <h2 style="margin-bottom: 20px; color: #333;">Mobile Measurement Tools</h2>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://bollardbuddy.com" 
                 style="margin: 20px 0;" alt="QR Code" />
            <p style="margin: 15px 0; color: #666;">Scan this QR code with your mobile device to access measurement tools</p>
            <p style="margin: 15px 0; color: #999; font-size: 14px;">Or visit: <a href="https://bollardbuddy.com" target="_blank">bollardbuddy.com</a></p>
            <button onclick="this.parentElement.remove()" 
                    style="margin-top: 20px; padding: 10px 30px; background: #7B46F6; 
                           color: white; border: none; border-radius: 4px; 
                           cursor: pointer; font-size: 16px;">Close</button>
          </div>
        `;
        document.body.appendChild(modal);
        break;
      }

      default:
        break;
    }
  };

  const scenesData = [
    {
      title: 'Create a basic street',
      description: 'Start with a pre-configured street template',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      actionType: 'basic_street',
      icon: <ManagedStreetIcon />
    },
    {
      title: 'Import from Streetmix',
      description: 'Import an existing Streetmix design',
      imagePath: '/ui_assets/cards/new-streetmix-import.jpg',
      actionType: 'streetmix',
      icon: (
        <img
          src="/ui_assets/cards/icons/streetmix24.png"
          alt="Streetmix"
          style={{ width: '32px', height: '32px' }}
        />
      )
    },
    {
      title: 'Create from geolocation',
      description: 'Start with maps and real-world context',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      actionType: 'geolocation',
      icon: (
        <div style={{ transform: 'scale(1.5)' }}>
          <GeospatialIcon />
        </div>
      )
    },
    {
      title: 'Create intersection',
      description: 'Begin with a 90° street intersection',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      actionType: 'intersection',
      icon: '➕'
    },
    {
      title: 'AR scene from panorama',
      description: 'Create an immersive 360° environment',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      actionType: 'ar_panorama',
      icon: '🌐'
    },
    {
      title: 'Create with AI assistant',
      description: 'Get help building your scene with AI',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      actionType: 'ai_assistant',
      icon: <ChatbotIcon />
    },
    {
      title: 'Mobile measurement tools',
      description: 'Measure real-world objects with your phone',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      actionType: 'mobile_measurement',
      icon: '📱'
    },
    {
      title: 'Create blank scene',
      description: 'Start from scratch with an empty canvas',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      actionType: 'blank',
      icon: '⬜'
    }
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create a New Scene"
      titleElement={
        <div className="flex items-center justify-between pr-4 pt-4">
          <div className="font-large text-center text-2xl">
            Create a New Scene
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setModal('scenes');
              }}
              leadingIcon={<Upload24Icon />}
            >
              Open Scene
            </Button>
            <Button
              onClick={() => {
                onClose();
                posthog.capture('new_blank_scene_header_clicked', {
                  timestamp: new Date().toISOString()
                });
                AFRAME.scenes[0].addEventListener(
                  'newScene',
                  () => {
                    saveScene(true);
                    posthog.capture('scene_created_from_header', {
                      template_type: 'blank',
                      timestamp: new Date().toISOString()
                    });
                  },
                  { once: true }
                );
                createBlankScene();
              }}
            >
              New Blank Scene
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.wrapper}>
        <div className={styles.templatesSection}>
          <h3 className={styles.sectionTitle}>Start with a template</h3>
          <div className={styles.cardsGrid}>
            {scenesData?.map((scene, index) => (
              <div
                key={index}
                className={styles.templateCard}
                onClick={() => handleActionClick(scene.actionType, scene)}
              >
                <div className={styles.cardIcon}>{scene.icon}</div>
                <div className={styles.cardContent}>
                  <h4 className={styles.cardTitle}>{scene.title}</h4>
                  <p className={styles.cardDescription}>{scene.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Onboarding section hidden for now
        <div className={styles.onboardingSection}>
          <h3 className={styles.sectionTitle}>Learn 3DStreet</h3>
          <div className={styles.onboardingOptions}>
            <button
              className={styles.onboardingButton}
              onClick={() => {
                posthog.capture('onboarding_clicked', { type: 'demo_video' });
                window.open(
                  'https://www.youtube.com/watch?v=YOUR_DEMO_VIDEO',
                  '_blank'
                );
              }}
            >
              <span className={styles.icon}>▶️</span>
              <span>Product demo video</span>
            </button>
            <button
              className={styles.onboardingButton}
              onClick={() => {
                posthog.capture('onboarding_clicked', { type: 'tour' });
                onClose();
                // TODO: Implement tour functionality
                alert('Tour feature coming soon!');
              }}
            >
              <span className={styles.icon}>👉</span>
              <span>Show me how (tour)</span>
            </button>
          </div>
        </div>
        */}
      </div>
    </Modal>
  );
};
