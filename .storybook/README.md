# 3DStreet Storybook

This Storybook showcases the shared components used across 3DStreet applications.

## Running Storybook

```bash
npm run storybook
```

This will start Storybook on http://localhost:6006

## Building Storybook

```bash
npm run build-storybook
```

## Components Included

### Navigation
- **AppSwitcher**: Dropdown menu for switching between 3DStreet Editor and AI Image Generator

### Auth
- **ProfileButton**: User profile button with authentication states
- **TokenDisplay**: Display for user's generation tokens

## Configuration

- **Main Config**: `.storybook/main.js` - Webpack configuration, addons, and story locations
- **Preview Config**: `.storybook/preview.js` - Global decorators and parameters
- **Stories Location**: `src/shared/**/*.stories.jsx` - Only shared component stories are included

## Features

- CSS Modules support for `.module.scss` files
- Path aliases (`@` and `@shared`) configured to match the main app
- Dark/light background themes
- Interactive controls for component props
