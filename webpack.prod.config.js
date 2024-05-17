const webpack = require('webpack');
const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const Dotenv = require('dotenv-webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
  mode: 'production',
  devtool: 'source-map',
  entry: {
    core: { import: './src/index.js', filename: 'dist/aframe-street-component.js' },
    editor: { import: './src/editor/index.js', filename: 'dist/3dstreet-editor.js'}
  },
  output: {
    path: path.join(__dirname, 'dist'),
    libraryTarget: 'umd'
  },
  externals: {
    // Stubs out `import ... from 'three'` so it returns `import ... from window.THREE` effectively using THREE global variable that is defined by AFRAME.
    three: 'THREE'
  },
  plugins: [
    new CleanWebpackPlugin(),
    new MiniCssExtractPlugin({
      filename: '[name].[contenthash].css',
      chunkFilename: '[id].[contenthash].css'
    }),
    new Dotenv({
      path: './config/.env.production'
    }),
    new webpack.DefinePlugin({
      VERSION: JSON.stringify(process.env.npm_package_version)
    })
  ],
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.svg$/,
        type: 'asset/inline'
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader']
      },
      {
        test: /\.module\.scss$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true
            }
          },
          {
            loader: 'sass-loader',
            options: {
              sourceMap: true
            }
          }
        ]
      },
      {
        test: /\.scss$/,
        exclude: /\.module\.scss$/,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'sass-loader',
            options: {
              sourceMap: true
            }
          }
        ]
      },
      {
        test: /\.(png|jpe?g|gif)$/i,
        use: [
          {
            loader: 'file-loader',
            options: {
              name: 'images/[name].[ext]'
            }
          }
        ]
      }
    ]
  }
};
