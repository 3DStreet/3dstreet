const webpack = require('webpack');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');
const Dotenv = require('dotenv-webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const DEFAULT_PORT = 3333;

// Full build identity: CalVer base from package.json + short git SHA.
// e.g. "2026.6.0+a1b2c3d". The base is bumped by hand at release time;
// the SHA advances automatically on every build so each deploy is unique.
function buildVersion() {
  const base = process.env.npm_package_version;
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    return `${base}+${sha}`;
  } catch {
    return base;
  }
}

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
    // @gltf-transform/core 4.4+ dynamically imports `node:fs` / `node:path`
    // in its PlatformIO detection. Those branches never run in the browser,
    // but webpack still resolves them statically and throws UnhandledSchemeError
    // on the `node:` URI scheme. Strip the prefix so the fs/path fallbacks
    // below substitute empty modules instead.
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '');
    }),
    new Dotenv({
      path: './config/.env.development'
    }),
    new webpack.DefinePlugin({
      VERSION: JSON.stringify(buildVersion())
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
              // css-loader v7 flipped modules.namedExport to true, which drops
              // the default export — breaking `import styles from './x.module.scss'`
              // app-wide (undefined styles). Restore v6 behavior: default export
              // with class names kept as-is (our SCSS classes are already camelCase).
              modules: {
                namedExport: false,
                exportLocalsConvention: 'as-is'
              },
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

module.exports = async () => {
  config.devServer.port = await findFreePort(DEFAULT_PORT);
  return config;
};
