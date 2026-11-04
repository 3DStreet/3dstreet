/**
 * AssetPickerModal stories (#2142).
 *
 * Renders AssetPickerModalView with a mock `gallery` (useAssets()-shaped), so
 * no Firebase session is needed. Each story shows a request the app makes:
 * the editor's "Choose a replacement …" and the generator's source-image
 * slots. Confirm/cancel log to the console.
 */

import { AssetPickerModalView } from './AssetPickerModal';

const mockItem = (i, type, overrides = {}) => ({
  id: `${type}-${i}`,
  type,
  userId: 'storybook-user',
  name: `${type === 'image' ? 'Street photo' : type === 'splat' ? 'Plaza capture' : 'Bench model'} ${i + 1}`,
  storageUrl: `https://example.com/${type}-${i}`,
  objectURL:
    type === 'image' ? `https://picsum.photos/seed/picker${i}/400/400` : '',
  thumbnailUrl: null,
  ...overrides
});

// A mixed library: the picker must show only the requested type.
const library = [
  ...Array.from({ length: 14 }, (_, i) => mockItem(i, 'image')),
  ...Array.from({ length: 4 }, (_, i) => mockItem(i, 'mesh')),
  ...Array.from({ length: 3 }, (_, i) => mockItem(i, 'splat')),
  mockItem(0, 'mesh', {
    id: 'mesh-thumb',
    name: 'Kiosk (with thumbnail)',
    thumbnailUrl: 'https://picsum.photos/seed/pickermesh/400/400'
  })
];

const gallery = (overrides = {}) => ({
  items: library,
  isLoading: false,
  isLoggedIn: true,
  hasMore: false,
  isLoadingMore: false,
  loadMore: () => {},
  ...overrides
});

export default {
  title: 'Shared/Assets/AssetPickerModal',
  component: AssetPickerModalView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Pick one asset of a given type from the library. The caller words the request (`title`) and the confirm button (`confirmLabel`, default "Replace"). A click selects and can be changed; nothing happens until confirm. Escape, the backdrop and Cancel close without side effects.'
      }
    }
  },
  args: {
    onConfirm: (item) => console.log('Confirmed:', item),
    onCancel: () => console.log('Cancelled'),
    onSignIn: () => console.log('Sign in')
  },
  argTypes: {
    type: { control: 'select', options: ['image', 'mesh', 'splat', 'video'] }
  }
};

export const ReplaceImage = {
  name: 'Editor: Choose a replacement image',
  args: {
    gallery: gallery(),
    type: 'image',
    title: 'Choose a replacement image',
    excludeAssetId: 'image-0'
  }
};

export const ReplaceModel = {
  name: 'Editor: Choose a replacement 3D model',
  args: {
    gallery: gallery(),
    type: 'mesh',
    title: 'Choose a replacement 3D model'
  }
};

export const ReplaceSplat = {
  name: 'Editor: Choose a replacement splat',
  args: {
    gallery: gallery(),
    type: 'splat',
    title: 'Choose a replacement splat'
  }
};

export const ImageToEdit = {
  name: 'Generator: Choose an image to edit',
  args: {
    gallery: gallery(),
    type: 'image',
    title: 'Choose an image to edit',
    confirmLabel: 'Choose'
  }
};

export const FirstFrame = {
  name: 'Generator: Choose an image for the first frame',
  args: {
    gallery: gallery(),
    type: 'image',
    title: 'Choose an image for the first frame',
    confirmLabel: 'Choose'
  }
};

export const Empty = {
  args: {
    gallery: gallery({ items: library.filter((i) => i.type !== 'splat') }),
    type: 'splat',
    title: 'Choose a replacement splat'
  }
};

export const Loading = {
  args: {
    gallery: gallery({ items: [], isLoading: true }),
    type: 'image',
    title: 'Choose an image to edit'
  }
};

export const SignedOut = {
  args: {
    gallery: gallery({ items: [], isLoggedIn: false }),
    type: 'image',
    title: 'Choose an image to edit'
  }
};
