const fs = require('fs');
const path = require('path');

/**
 * Load the Avenx configuration from avenx.config.json file.
 */
function loadConfig() {
  const defaults = {
    srcDir: 'src',
    distDir: 'dist',
    templatesDir: '.avenxtemplates',
    server: {
      port: 3000,
      host: 'localhost',
    },
  };

  const configPath = path.join(process.cwd(), 'avenx.config.json');

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const config = {
      ...defaults,
      ...userConfig,
      server: {
        ...defaults.server,
        ...(userConfig.server || {}),
      },
    };

    if (typeof config.srcDir !== 'string') {
      throw new Error('srcDir must be a string');
    }

    if (typeof config.distDir !== 'string') {
      throw new Error('distDir must be a string');
    }

    if (typeof config.templatesDir !== 'string') {
      throw new Error('templatesDir must be a string');
    }

    if (typeof config.server.port !== 'number') {
      throw new Error('server.port must be a number');
    }

    if (config.server.host && typeof config.server.host !== 'string') {
      throw new Error('server.host must be a string');
    }

    return config;
  } catch (err) {
    console.error(`Invalid avenx.config.json: ${err.message}`);
    process.exit(1);
  }
}

module.exports = loadConfig;
