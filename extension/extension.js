const vscode = require('vscode');
const http = require('node:http');
const https = require('node:https');

const CONFIG_SECTION = 'simpleAgent';

let outputChannel;
let statusBarItem;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Simple Agent');
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'simpleAgent.showConfig';
  context.subscriptions.push(outputChannel, statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('simpleAgent.ask', askQuestion),
    vscode.commands.registerCommand('simpleAgent.setApiKey', setApiKey),
    vscode.commands.registerCommand('simpleAgent.clearApiKey', clearApiKey),
    vscode.commands.registerCommand('simpleAgent.showConfig', showConfig),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        updateStatusBar();
      }
    })
  );

  updateStatusBar();
}

function deactivate() {}

function getConfig() {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    endpoint: String(config.get('endpoint', '') || '').trim(),
    model: String(config.get('model', '') || '').trim(),
    apiKey: String(config.get('apiKey', '') || ''),
    apiKeyHeader: String(config.get('apiKeyHeader') || 'Authorization').trim() || 'Authorization',
    apiKeyPrefix: String(config.get('apiKeyPrefix', 'Bearer ') || ''),
    requestMode: String(config.get('requestMode') || 'openai_chat').trim() || 'openai_chat',
    timeoutMs: Number(config.get('timeoutMs', 60000) || 60000)
  };
}

function isConfigured(config) {
  return Boolean(config.endpoint && config.model && config.apiKey);
}

function updateStatusBar() {
  const config = getConfig();
  const configured = isConfigured(config);
  statusBarItem.text = configured ? '$(check) Simple Agent' : '$(warning) Simple Agent';
  statusBarItem.tooltip = configured
    ? `Simple Agent is configured for ${config.model}`
    : 'Simple Agent is missing endpoint, model, or apiKey';
  statusBarItem.backgroundColor = configured ? undefined : new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarItem.show();
}

async function askQuestion() {
  const config = getConfig();
  if (!isConfigured(config)) {
    updateStatusBar();
    vscode.window.showWarningMessage('Simple Agent is missing endpoint, model, or apiKey.');
    return;
  }

  const prompt = await vscode.window.showInputBox({
    prompt: 'Ask the internal AI endpoint',
    placeHolder: 'Enter a prompt',
    ignoreFocusOut: true
  });

  if (!prompt) {
    return;
  }

  outputChannel.appendLine(`[${new Date().toISOString()}] Prompt:`);
  outputChannel.appendLine(prompt);
  outputChannel.appendLine('');
  outputChannel.show(true);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Simple Agent is waiting for a response...',
      cancellable: false
    },
    async () => {
      try {
        const response = await requestCompletion(config, prompt);
        outputChannel.appendLine(`[${new Date().toISOString()}] Response:`);
        outputChannel.appendLine(response);
        outputChannel.appendLine('');
        outputChannel.show(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[${new Date().toISOString()}] Error:`);
        outputChannel.appendLine(message);
        outputChannel.appendLine('');
        outputChannel.show(true);
        vscode.window.showErrorMessage(`Simple Agent request failed: ${message}`);
      }
    }
  );
}

async function setApiKey() {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Set Simple Agent API key',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'Enter API key'
  });

  if (apiKey === undefined) {
    return;
  }

  await vscode.workspace.getConfiguration(CONFIG_SECTION).update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
  updateStatusBar();
  vscode.window.showInformationMessage('Simple Agent API key saved to settings.');
}

async function clearApiKey() {
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update('apiKey', undefined, vscode.ConfigurationTarget.Global);
  updateStatusBar();
  vscode.window.showInformationMessage('Simple Agent API key cleared from settings.');
}

async function showConfig() {
  const config = getConfig();
  const safeConfig = {
    ...config,
    apiKey: maskSecret(config.apiKey)
  };

  outputChannel.appendLine(`[${new Date().toISOString()}] Config:`);
  outputChannel.appendLine(JSON.stringify(safeConfig, null, 2));
  outputChannel.appendLine('');
  outputChannel.show(true);
  await vscode.window.showInformationMessage('Simple Agent configuration written to the Output panel.');
}

async function requestCompletion(config, prompt) {
  const headerName = sanitizeHeaderName(config.apiKeyHeader);
  const headerValue = sanitizeHeaderValue(`${config.apiKeyPrefix}${config.apiKey}`);
  const headers = {
    'Content-Type': 'application/json',
    [headerName]: headerValue
  };
  const body = JSON.stringify(buildPayload(config, prompt));
  const response = await postJson(config.endpoint, headers, body, config.timeoutMs);
  return extractResponseText(response);
}

function buildPayload(config, prompt) {
  if (config.requestMode === 'openai_chat') {
    return {
      model: config.model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      stream: false
    };
  }

  return {
    model: config.model,
    prompt
  };
}

function postJson(urlString, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      rejectOnce(new Error('Invalid endpoint URL.'));
      return;
    }

    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            rejectOnce(new Error(`HTTP ${response.statusCode || 0}: ${truncateText(raw, 500)}`));
            return;
          }

          try {
            resolveOnce(raw ? JSON.parse(raw) : {});
          } catch (error) {
            rejectOnce(new Error(`Response was not valid JSON: ${truncateText(raw, 500)}`));
          }
        });
      }
    );

    const timeoutHandle = setTimeout(() => {
      const error = new Error(`Request timed out after ${timeoutMs} ms.`);
      request.destroy();
      rejectOnce(error);
    }, timeoutMs);

    request.on('close', () => clearTimeout(timeoutHandle));
    request.on('error', (error) => {
      clearTimeout(timeoutHandle);
      rejectOnce(error);
    });
    request.write(body);
    request.end();
  });
}

function extractResponseText(response) {
  const openAiContent = response?.choices?.[0]?.message?.content;
  if (typeof openAiContent === 'string') {
    const trimmedContent = openAiContent.trim();
    if (trimmedContent) {
      return trimmedContent;
    }
  }

  if (Array.isArray(openAiContent)) {
    const combined = openAiContent
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (typeof part?.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('')
      .trim();
    if (combined) {
      return combined;
    }
  }

  const textCandidates = [
    response?.choices?.[0]?.text,
    response?.output_text,
    response?.response,
    response?.data?.response,
    response?.message
  ];
  for (const candidate of textCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return JSON.stringify(response, null, 2);
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function maskSecret(secret) {
  if (!secret) {
    return '';
  }
  return `[configured:${secret.length}]`;
}

function sanitizeHeaderName(headerName) {
  if (!/^[A-Za-z0-9-]+$/.test(headerName)) {
    throw new Error('apiKeyHeader must contain only letters, numbers, and hyphens.');
  }
  return headerName;
}

function sanitizeHeaderValue(headerValue) {
  if (/[\r\n]/.test(headerValue)) {
    throw new Error('API key header value cannot contain newline characters.');
  }
  return headerValue;
}

module.exports = {
  activate,
  deactivate
};
