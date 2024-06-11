const webpack = require('webpack');
const path = require('path');
const Dotenv = require('dotenv-webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');

module.exports = {
  mode: 'development',
  devServer: {
    hot: true,
    liveReload: false,
    port: 3333,
    static: {
      directory: '.',
      watch: {
        ignored: ['.*', '**/node_modules']
      }
    }
  },
  devtool: 'source-map',
  entry: {
    editor: {
      import: ['./src/editor/index.js'],
      filename: '3dstreet-editor.js'
    },
    // react-refresh doesn't work with multiple entry points so we use the production build of aframe-street-component.js in development,
    // you will need to run `npm run dist` to see your changes or uncomment temporarily the following line and run `npm start` again.
    core: { import: './src/index.js', filename: 'aframe-street-component.js' }
  },
  output: {
    publicPath: '/dist/',
    path: path.join(__dirname, 'dist'),
    libraryTarget: 'umd'
  },
  externals: {
    // Stubs out `import ... from 'three'` so it returns `import ... from window.THREE` effectively using THREE global variable that is defined by AFRAME.
    three: 'THREE'
  },
  plugins: [
    new ReactRefreshWebpackPlugin(),
    new Dotenv({
      path: './config/.env.development'
    }),
    new webpack.DefinePlugin({
      VERSION: JSON.stringify(process.env.npm_package_version)
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/lib/aframe-mapbox-component.min.js' },
        { from: 'src/notyf.min.css' },
        { from: 'src/viewer-styles.css' }
      ]
    })
  ],
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            plugins: ['react-refresh/babel']
          }
        }
      },
      {
        test: /\.svg$/,
        type: 'asset/inline'
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
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
        type: 'asset/resource',
        generator: {
          filename: 'images/[name].[ext]'
        }
      }
    ]
  }
};
