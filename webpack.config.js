const path = require('path');
const webpack = require('webpack');
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
  },
  plugins: [
    new webpack.DefinePlugin({
      VERSION: JSON.stringify(process.env.npm_package_version)
    }),
    new webpack.DefinePlugin({
      COMMIT_DATE: JSON.stringify(require('child_process').execSync('git log -1 --format=%cd').toString().trim())
    }),
    new webpack.DefinePlugin({
      COMMIT_HASH: JSON.stringify(require('child_process').execSync('git rev-parse --short HEAD').toString().trim())
    })
  ]
};
