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
  },
  "voidTags": []
}
```

## Options

| Option         | Type       | Default              | Rules                                                                 |
| -------------- | ---------- | --------------------- | ---------------------------------------------------------------------- |
| `srcDir`       | `string`   | `"src"`              | Non-empty relative path to application source files.                  |
| `distDir`      | `string`   | `"dist"`              | Non-empty relative path where compiled output is written.             |
| `templatesDir` | `string`   | `".avenxtemplates"`  | Non-empty relative path for local generator template overrides.       |
| `server.port`  | `number`   | `3000`                | Valid TCP port from `0` to `65535`.                                    |
| `server.host`  | `string`   | `"localhost"`         | Non-empty host name or address for the local dev server.              |
| `voidTags`     | `string[]` | `[]`                   | Extra tag names the compiler treats as void (self-closing), in addition to the built-in HTML void tags (`img`, `br`, `input`, etc.). Each entry must be a non-empty string. |

Path options must be relative paths. Absolute paths are rejected during configuration loading.

## Custom void tags

If your templates use custom or web-component tags that are always self-closing by convention (e.g. `<my-video>` without a trailing slash), list them under `voidTags` so the compiler doesn't wait for a closing tag that will never arrive:

```json
{
  "voidTags": ["my-video", "custom-icon"]
}
```

Tags written with an explicit self-closing slash, like `<my-video />`, are already parsed correctly without any configuration — `voidTags` is only needed for the no-slash convention.

## Example

```json
{
  "srcDir": "app",
  "distDir": "public/build",
  "templatesDir": ".avenxtemplates",
  "server": {
    "port": 5173,
    "host": "0.0.0.0"
  },
  "voidTags": ["my-video"]
}
```

The configuration is merged with the defaults, so you can override only the settings your project needs.

## Logging Options

Avenx-JS includes a configurable logging system that can be customized globally through the `logging` section in `avenx.config.json`.

### Configuration

```json
{
  "logging": {
    "level": "info",
    "silent": false
  }
}
```

### Available Options

| Option | Type | Default | Description |
| ------- | ---- | ------- | ----------- |
| `level` | `string` | `"info"` | Sets the minimum log level that will be displayed. |
| `silent` | `boolean` | `false` | Disables all logging output when set to `true`. |

### Supported Log Levels

Log levels are ordered by severity. Messages below the configured level are ignored.

| Level | Description |
| ------- | ----------- |
| `trace` | Very detailed diagnostic information. |
| `debug` | Debugging information useful during development. |
| `info` | General informational messages. |
| `warn` | Warning messages that do not stop execution. |
| `error` | Errors encountered during execution. |
| `fatal` | Critical errors requiring immediate attention. |
| `off` | Disables all logging. |
| `silent` | Alias for `off`. |

### Example: Enable Debug Logging

```json
{
  "logging": {
    "level": "debug"
  }
}
```

### Example: Disable All Logging

```json
{
  "logging": {
    "silent": true
  }
}
```

When both `silent` and `level` are provided, setting `silent` to `true` suppresses all log output regardless of the configured log level.