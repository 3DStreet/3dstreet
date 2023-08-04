const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'aframe-street-component.js',
    libraryTarget: 'umd'
  },
  module: {
    rules: [
      { test: /\.js$/, loader: 'babel-loader' }
    ]
  },
  optimization: {
    minimizer: [new TerserPlugin({ extractComments: false })]
  }
};
