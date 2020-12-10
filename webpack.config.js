const path = require('path');

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
  }
};
