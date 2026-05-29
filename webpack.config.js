const webpack = require('webpack');
const path = require('path');
const Dotenv = require('dotenv-webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'development',
  devServer: {
    liveReload: false,
    port: 3333,
    allowedHosts: 'all',
    static: [
      {
        directory: '.',
        watch: {
          ignored: ['.*', '**/node_modules']
        }
      },
      {
        directory: path.join(__dirname, 'public'),
        publicPath: '/',
        watch: {
          ignored: ['**/.*', '**/node_modules/**']
        }
      }
    ]
  },
  devtool: 'source-map',
  entry: {
    core: { import: './src/index.js', filename: 'aframe-street-component.js' },
    generator: {
      import: './src/generator/index.js',
      filename: 'generator.js'
    },
    bollardbuddy: {
      import: './src/bollardbuddy/index.js',
      filename: 'bollardbuddy.js'
    }
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
        { from: 'src/viewer-styles.css' },
        // Draco's Emscripten loader fetches its WASM relative to publicPath
        // (/dist/). Copy both decoder + encoder blobs alongside the bundle.
        { from: 'node_modules/draco3dgltf/draco_decoder_gltf.wasm' },
        { from: 'node_modules/draco3dgltf/draco_encoder.wasm' }
      ]
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
              sourceMap: true,
              api: 'modern',
              sassOptions: {
                silenceDeprecations: ['import']
              }
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
              sourceMap: true,
              api: 'modern',
              sassOptions: {
                silenceDeprecations: ['import']
              }
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
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared')
    },
    // draco3dgltf's Node entry points (draco_*_nodejs.js) require('fs') /
    // require('path') only on the Node branch; the browser branch never hits
    // them at runtime. Telling webpack to substitute empty modules silences
    // the static-analysis errors without affecting the WASM browser path.
    fallback: {
      fs: false,
      path: false
    }
  }
};
