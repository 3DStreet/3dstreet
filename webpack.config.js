const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'development',
  devServer: {
    hot: true,
    liveReload: false,
    port: 3333,
    static: {
      directory: '.'
    }
  },
  entry: {
    core: { import: './src/index.js', filename: 'dist/aframe-street-component.js' },
    editor: { import: './src/editor/index.js', filename: 'dist/3dstreet-editor.js'}
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    libraryTarget: 'umd'
  },
  module: {
    rules: [
      { test: /\.js$/, loader: 'babel-loader' }
    ]
  },
  optimization: {
    minimizer: [new TerserPlugin({ extractComments: false })]
  },
  plugins: [
    new webpack.DefinePlugin({
      VERSION: JSON.stringify(process.env.npm_package_version)
    })
  ]
};
