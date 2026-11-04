// MCP Server for Vendor Catalogs
// Provides mock product data for mechanical keyboards and wireless mice

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema,
  ToolSchema 
} from '@modelcontextprotocol/sdk/types.js';
import catalog from './catalog.json' with { type: 'json' };

const server = new Server(
  {
    name: "vendor-catalog-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_vendors",
        description: "List all approved vendor names",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "search_products",
        description: "Search for products by category with optional filters",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Product category",
              enum: ["mechanical_keyboard", "wireless_mouse"]
            },
            maxUnitPrice: {
              type: "number",
              description: "Maximum unit price in USD"
            },
            minRating: {
              type: "number",
              description: "Minimum rating (1-5)"
            },
            minStock: {
              type: "number",
              description: "Minimum stock available"
            }
          },
          required: ["category"]
        }
      },
      {
        name: "get_quote",
        description: "Get a live-style quote for a product",
        inputSchema: {
          type: "object",
          properties: {
            sku: {
              type: "string",
              description: "Product SKU"
            },
            quantity: {
              type: "number",
              description: "Quantity to quote"
            }
          },
          required: ["sku", "quantity"]
        }
      }
    ]
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_vendors") {
    const vendorNames = Object.keys(catalog.vendors);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(vendorNames, null, 2)
        }
      ]
    };
  }

  if (name === "search_products") {
    const { category, maxUnitPrice, minRating, minStock } = args;
    
    let products = catalog.products.filter(p => p.category === category);
    
    if (maxUnitPrice !== undefined) {
      products = products.filter(p => p.price <= maxUnitPrice);
    }
    
    if (minRating !== undefined) {
      products = products.filter(p => p.rating >= minRating);
    }
    
    if (minStock !== undefined) {
      products = products.filter(p => p.stock >= minStock);
    }
    
    // Enrich with vendor info
    const enriched = products.map(p => ({
      ...p,
      vendorInfo: catalog.vendors[p.vendor]
    }));
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(enriched, null, 2)
        }
      ]
    };
  }

  if (name === "get_quote") {
    const { sku, quantity } = args;
    
    const product = catalog.products.find(p => p.sku === sku);
    
    if (!product) {
      throw new Error(`Product not found: ${sku}`);
    }
    
    if (product.stock < quantity) {
      throw new Error(`Insufficient stock for ${sku}: ${quantity} requested, ${product.stock} available`);
    }
    
    const vendor = catalog.vendors[product.vendor];
    const lineTotal = product.price * quantity;
    const quoteId = `Q-${Date.now()}-${sku}`;
    const expiryTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
    
    const quote = {
      quoteId,
      sku: product.sku,
      name: product.name,
      vendor: product.vendor,
      quantity,
      unitPrice: product.price,
      lineTotal,
      shipping: vendor.shippingFlat,
      total: lineTotal + vendor.shippingFlat,
      stockAvailable: product.stock,
      deliveryDays: vendor.deliveryDays,
      expiryTime
    };
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(quote, null, 2)
        }
      ]
    };
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Vendor MCP server running on stdio');
}

main().catch(console.error);
