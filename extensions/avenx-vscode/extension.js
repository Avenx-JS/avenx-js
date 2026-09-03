const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const diagnosticCollection =
  vscode.languages.createDiagnosticCollection('avenx');

const runningChecks = new Map();

function getWorkspaceRoot(document) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

  if (!workspaceFolder) {
    return null;
  }

  return workspaceFolder.uri.fsPath;
}

function getAvenxCliPath(workspaceRoot) {
  const candidates = [
    path.join(workspaceRoot, 'node_modules', 'avenx-core', 'bin', 'avenx.js'),
    path.join(workspaceRoot, 'node_modules', '@avenx-js', 'core', 'bin', 'avenx.js'),
    path.join(workspaceRoot, 'bin', 'avenx.js')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isAvenxFile(document) {
  const fileName = document.fileName;

  return (
    fileName.endsWith('.component.js') ||
    fileName.endsWith('.page.js') ||
    fileName.endsWith('.bridge.js') ||
    fileName.endsWith('.guard.js') ||
    fileName.endsWith('.component.css')
  );
}

function normalizePath(filePath) {
  return path.normalize(path.resolve(filePath));
}

function diagnosticSeverity(value) {
  return value === 'warning'
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Error;
}

function createDiagnostic(item, document) {
  const line = Number.isInteger(item.line)
    ? Math.max(0, item.line - 1)
    : 0;

  const column = Number.isInteger(item.column)
    ? Math.max(0, item.column)
    : 0;

  const start = new vscode.Position(line, column);

  let end = start;

  if (Number.isInteger(item.length) && item.length > 0) {
    end = new vscode.Position(line, column + item.length);
  } else {
    const lineText =
      line < document.lineCount
        ? document.lineAt(line).text
        : '';

    end = new vscode.Position(
      line,
      Math.min(column + 1, lineText.length),
    );
  }

  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(start, end),
    item.message || 'Avenx validation error.',
    diagnosticSeverity(item.severity),
  );

  if (item.code) {
    diagnostic.code = item.code;
  }

  diagnostic.source = 'Avenx';

  return diagnostic;
}

function parseCheckOutput(output) {
  const trimmed = output.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractDiagnostics(report, document) {
  if (!report || !Array.isArray(report.diagnostics)) {
    return [];
  }

  const documentPath = normalizePath(document.fileName);

  return report.diagnostics
    .filter((item) => {
      if (!item || !item.file) {
        return true;
      }

      return normalizePath(item.file) === documentPath;
    })
    .map((item) => createDiagnostic(item, document));
}

function runAvenxCheck(document) {
  if (!isAvenxFile(document)) {
    return;
  }

  const workspaceRoot = getWorkspaceRoot(document);

  if (!workspaceRoot) {
    return;
  }

  const config = vscode.workspace.getConfiguration(
    'avenx',
    document.uri,
  );

  if (!config.get('enableDiagnostics', true)) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  const cliPath = getAvenxCliPath(workspaceRoot);

  if (!cliPath) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  const previous = runningChecks.get(document.uri.toString());

  if (previous) {
    previous.kill();
  }

  const child = spawn(
    process.execPath,
    [cliPath, 'check', '--json'],
    {
      cwd: workspaceRoot,
      windowsHide: true,
    },
  );

  runningChecks.set(document.uri.toString(), child);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('error', () => {
    runningChecks.delete(document.uri.toString());
  });

  child.on('close', () => {
    runningChecks.delete(document.uri.toString());

    const report = parseCheckOutput(stdout);

    if (!report) {
      if (stderr.trim()) {
        console.warn(
          `[Avenx] Unable to parse check output: ${stderr.trim()}`,
        );
      }

      return;
    }

    const diagnostics = extractDiagnostics(report, document);

    diagnosticCollection.set(document.uri, diagnostics);
  });
}

function scheduleCheck(document) {
  const config = vscode.workspace.getConfiguration(
    'avenx',
    document.uri,
  );

  const delay = Math.max(
    0,
    Number(config.get('diagnosticDelay', 150)),
  );

  const key = document.uri.toString();
  const existingTimer = scheduleCheck.timers?.get(key);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  if (!scheduleCheck.timers) {
    scheduleCheck.timers = new Map();
  }

  const timer = setTimeout(() => {
    scheduleCheck.timers.delete(key);
    runAvenxCheck(document);
  }, delay);

  scheduleCheck.timers.set(key, timer);
}

function activate(context) {
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isAvenxFile(document)) {
        scheduleCheck(document);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();

      const timer = scheduleCheck.timers?.get(key);

      if (timer) {
        clearTimeout(timer);
        scheduleCheck.timers.delete(key);
      }

      const child = runningChecks.get(key);

      if (child) {
        child.kill();
        runningChecks.delete(key);
      }

      diagnosticCollection.delete(document.uri);
    }),
  );
}

function deactivate() {
  for (const child of runningChecks.values()) {
    child.kill();
  }

  runningChecks.clear();

  if (scheduleCheck.timers) {
    for (const timer of scheduleCheck.timers.values()) {
      clearTimeout(timer);
    }

    scheduleCheck.timers.clear();
  }

  diagnosticCollection.clear();
}

module.exports = {
  activate,
  deactivate,
};
