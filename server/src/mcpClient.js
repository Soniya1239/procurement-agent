// MCP Client
// Connects to the vendor MCP server over stdio to query product catalogs

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mcpClient = null;

export async function initMCPClient() {
  if (mcpClient) {
    return mcpClient;
  }

  mcpClient = new Client(
    {
      name: "procurement-agent",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  const serverPath = join(__dirname, '../mcp/vendorServer.js');
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath]
  });

  await mcpClient.connect(transport);
  console.log('MCP client connected to vendor server');
  return mcpClient;
}

export async function callTool(name, args) {
  const client = await initMCPClient();
  
  const result = await client.callTool({
    name,
    arguments: args
  });

  // Parse the text content from the response
  const textContent = result.content?.[0]?.text;
  if (textContent) {
    return JSON.parse(textContent);
  }
  
  return result;
}

export async function listVendors() {
  return callTool('list_vendors', {});
}

export async function searchProducts({ category, maxUnitPrice, minRating, minStock }) {
  return callTool('search_products', { category, maxUnitPrice, minRating, minStock });
}

export async function getQuote({ sku, quantity }) {
  return callTool('get_quote', { sku, quantity });
}
