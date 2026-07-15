---
title: 'Installation'
description: 'Step-by-step installation instructions for Avenx-JS using npm and npx.'
---
## Prerequisites

Before installing the Avenx CLI, ensure your environment meets the following requirements:

*   **Node.js**: Version `18.0.0` or later is strictly required.
*   **Compatibility Check**: Upon startup, the CLI automatically verifies your Node.js engine version. Running the CLI on unsupported, older environments will cause the application to terminate immediately with an exit code `1`.

To begin using Avenx-JS, make sure you have [Node.js](https://nodejs.org/) (v16 or higher recommended) installed on your machine.

## Installing the Core package

Install the Avenx package globally or locally in your project:

```bash
npm install avenx-core
```

Or run it directly using `npx` to initialize a new project structure:

```bash
npx avenx init
```

## System Requirements

| Dependency     | Requirement       | Purpose                                   |
| -------------- | ----------------- | ----------------------------------------- |
| Node.js        | v16.0.0+          | Running CLI commands and local dev server |
| NPM / Yarn     | v7.0.0+           | Installing dependency packages            |
| Modern Browser | ES6 Proxy support | Required for the reactive runtime engine  |
