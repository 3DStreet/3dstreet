import { describe, expect, it } from 'vitest';
import { createEntity } from '@/editor/lib/entity.jsx';

// The jsdom suite loads the entity module (entity.jsx) and panels that reach
// the cloud-scene API at module evaluation. These pin that both load, so a test
// of a panel or of entity.jsx can use the real module rather than a mock.

describe('editor modules load under jsdom', () => {
  it('createEntity builds and appends a plain entity under the given parent (fails if entity.jsx cannot be transformed)', () => {
    const parent = document.createElement('a-entity');
    parent.id = 'smoke-parent';
    document.body.append(parent);

    const created = createEntity(
      {
        class: 'smoke-item',
        'data-layer-name': 'Smoke',
        components: { position: '1 2 3' }
      },
      () => {},
      parent
    );

    expect(created.parentNode).toBe(parent);
    expect(created.id).toBeTruthy();
    expect(created.getAttribute('class')).toBe('smoke-item');
    expect(created.getAttribute('data-layer-name')).toBe('Smoke');
    expect(created.getAttribute('position')).toBe('1 2 3');
    parent.remove();
  });

  it.each([
    [
      'SceneGraph',
      () => import('@/editor/components/scenegraph/SceneGraph.jsx')
    ],
    [
      'AddLayerPanel',
      () =>
        import('@/editor/components/elements/AddLayerPanel/AddLayerPanel.component.jsx')
    ],
    [
      'AssetsPanel',
      () => import('@/editor/components/scenegraph/AssetsPanel.jsx')
    ],
    ['AppMenu', () => import('@/editor/components/scenegraph/AppMenu.jsx')],
    [
      'ActionBar',
      () =>
        import('@/editor/components/elements/ActionBar/ActionBar.component.jsx')
    ]
  ])(
    '%s imports (fails if the cloud-scene API throws at module evaluation)',
    async (_name, load) => {
      const module = await load();
      expect(Object.keys(module).length).toBeGreaterThan(0);
    },
    // A cold transform of the panel trees takes several seconds.
    60000
  );
});
