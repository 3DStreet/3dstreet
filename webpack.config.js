const webpack = require('webpack');
const path = require('path');
const net = require('net');
const Dotenv = require('dotenv-webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const DEFAULT_PORT = 3333;

// Find a free port, starting at `basePort` and incrementing on conflict.
// Lets multiple dev servers (e.g. one per git worktree) run at once instead
// of failing with EADDRINUSE on the hardcoded default.
function findFreePort(basePort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(basePort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(basePort, () => {
      server.close(() => resolve(basePort));
    });
  });
}

const config = {
  mode: 'development',
  devServer: {
    liveReload: false,
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
        publicPath: '/'
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
    }
  }
};

module.exports = async () => {
  config.devServer.port = await findFreePort(DEFAULT_PORT);
  return config;
};
