---
title: 'Configuration'
description: 'Configure Avenx-JS project paths, template overrides, and the local development server.'
---

Avenx-JS reads optional project settings from `avenx.config.json` in the project root. When the file is missing, the CLI uses the default values below.

```json
{
  "srcDir": "src",
  "distDir": "dist",
  "templatesDir": ".avenxtemplates",
  "server": {
    "port": 3000,
    "host": "localhost"
  }
}
```

## Options

| Option         | Type     | Default             | Rules                                                           |
| -------------- | -------- | ------------------- | --------------------------------------------------------------- |
| `srcDir`       | `string` | `"src"`             | Non-empty relative path to application source files.            |
| `distDir`      | `string` | `"dist"`            | Non-empty relative path where compiled output is written.       |
| `templatesDir` | `string` | `".avenxtemplates"` | Non-empty relative path for local generator template overrides. |
| `server.port`  | `number` | `3000`              | Valid TCP port from `0` to `65535`.                             |
| `server.host`  | `string` | `"localhost"`       | Non-empty host name or address for the local dev server.        |

Path options must be relative paths. Absolute paths are rejected during configuration loading.

## Example

```json
{
  "srcDir": "app",
  "distDir": "public/build",
  "templatesDir": ".avenxtemplates",
  "server": {
    "port": 5173,
    "host": "0.0.0.0"
  }
}
```

The configuration is merged with the defaults, so you can override only the settings your project needs.
