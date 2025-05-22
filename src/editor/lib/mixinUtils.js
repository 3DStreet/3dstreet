/**
 * Utility functions for working with A-Frame mixins in 3DStreet
 */

// Import the catalog if needed for additional metadata
import mixinCatalog from '../../catalog.json';

// Base asset path for images
const assetBasePath = 'https://assets.3dstreet.app/';

/**
 * Gets all mixin data divided into groups, from a-mixin DOM elements
 * This is a standardized function to be used across the application
 * @param {boolean} includeMetadata - Whether to include additional metadata from the catalog
 * @returns {Array} An array of grouped mixins by category
 */
export const getGroupedMixinOptions = (includeMetadata = false) => {
  const mixinElements = document.querySelectorAll('a-mixin');
  const groupedArray = [];
  let categoryName, mixinId;

  // If we need metadata, convert the mixins array into an object for faster access
  const mixinCatalogObj = {};
  if (includeMetadata) {
    for (const item of mixinCatalog) {
      mixinCatalogObj[item.id] = item;
    }
  }

  const groupedObject = {};
  let index = 0;
  for (const mixinEl of Array.from(mixinElements)) {
    categoryName = mixinEl.getAttribute('category');
    if (!categoryName) continue;

    if (!groupedObject[categoryName]) {
      groupedObject[categoryName] = [];
    }

    mixinId = mixinEl.id;

    if (includeMetadata) {
      // Enhanced version with metadata from catalog
      const mixinDataFromCatalog = mixinCatalogObj[mixinId];
      let mixinImg = '';
      let mixinName = '';
      let mixinDescr = '';

      if (mixinDataFromCatalog && mixinDataFromCatalog.display !== 'none') {
        mixinImg = mixinDataFromCatalog.img;
        mixinName = mixinDataFromCatalog.name;
        mixinDescr = mixinDataFromCatalog.description;
      }

      // If mixinImg does not contain http, then prepend the base asset path
      if (mixinImg && !mixinImg.includes('http')) {
        mixinImg = assetBasePath + mixinImg;
      }

      const mixinData = {
        img: mixinImg,
        icon: '',
        mixinId: mixinId,
        name: mixinName || mixinId,
        description: mixinDescr,
        label: mixinId,
        value: mixinId,
        id: index
      };

      if (!mixinDataFromCatalog || mixinDataFromCatalog.display !== 'none') {
        groupedObject[categoryName].push(mixinData);
      }
    } else {
      // Simple version without metadata
      groupedObject[categoryName].push({
        label: mixinId,
        value: mixinId
      });
    }
    index += 1;
  }

  // Convert the grouped object to an array format
  for (const [categoryName, options] of Object.entries(groupedObject)) {
    groupedArray.push({
      label: categoryName,
      options: options
    });
  }

  return groupedArray;
};

/**
 * Gets a flat list of all available mixin IDs
 * Useful for generating lists of available models
 * @returns {Array} An array of mixin IDs
 */
export const getAllMixinIds = () => {
  const mixinElements = document.querySelectorAll('a-mixin');
  const mixinIds = [];

  for (const mixinEl of Array.from(mixinElements)) {
    // Only include mixins that have a category (are meant to be user-accessible)
    if (mixinEl.getAttribute('category')) {
      const mixinDataFromCatalog = mixinCatalog.find(
        (item) => item.id === mixinEl.id
      );
      if (!mixinDataFromCatalog || mixinDataFromCatalog.display !== 'none') {
        mixinIds.push(mixinEl.id);
      }
    }
  }

  return mixinIds;
};
