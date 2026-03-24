import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import * as cheerio from 'cheerio';

// ============================================================
// WEB SEARCH
// ============================================================
toolRegistry.register(
  {
    name: 'web_search',
    category: 'web',
    description: 'Search the web using DuckDuckGo. Returns titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        numResults: { type: 'number', description: 'Number of results', default: 5 },
      },
      required: ['query'],
    },
    riskLevel: 'safe',
  },
  z.object({ query: z.string(), numResults: z.number().optional() }),
  async (args) => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgenticRAG/1.0)' },
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      const results: { title: string; url: string; snippet: string }[] = [];

      $('.result').each((i, el) => {
        if (i >= (args.numResults || 5)) return false;
        const title = $(el).find('.result__title a').text().trim();
        const link = $(el).find('.result__title a').attr('href') || '';
        const snippet = $(el).find('.result__snippet').text().trim();
        if (title && link) {
          results.push({ title, url: link, snippet });
        }
      });

      return { query: args.query, results, count: results.length };
    } catch (error: any) {
      return { query: args.query, results: [], error: error.message };
    }
  }
);

// ============================================================
// WEB SCRAPE
// ============================================================
toolRegistry.register(
  {
    name: 'web_scrape',
    category: 'web',
    description: 'Scrape content from a URL. Extracts text, links, and structured data.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to scrape' },
        selector: { type: 'string', description: 'CSS selector to extract specific content' },
        extractLinks: { type: 'boolean', description: 'Also extract all links', default: false },
      },
      required: ['url'],
    },
    riskLevel: 'safe',
    timeout: 30000,
  },
  z.object({ url: z.string(), selector: z.string().optional(), extractLinks: z.boolean().optional() }),
  async (args) => {
    const response = await fetch(args.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgenticRAG/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove script and style tags
    $('script, style, nav, footer, header').remove();

    let content: string;
    if (args.selector) {
      content = $(args.selector).text().trim();
    } else {
      content = $('main, article, .content, #content, body').first().text().trim();
    }

    // Clean up whitespace
    content = content.replace(/\s+/g, ' ').substring(0, 50000);

    const result: any = {
      url: args.url,
      title: $('title').text().trim(),
      content,
      contentLength: content.length,
    };

    if (args.extractLinks) {
      const links: { text: string; href: string }[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
          links.push({ text: text.substring(0, 100), href });
        }
      });
      result.links = links.slice(0, 50);
    }

    return result;
  }
);

// ============================================================
// WEB FETCH (raw content)
// ============================================================
toolRegistry.register(
  {
    name: 'web_fetch',
    category: 'web',
    description: 'Fetch raw content from a URL (JSON, text, HTML).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
      },
      required: ['url'],
    },
    riskLevel: 'safe',
    timeout: 30000,
  },
  z.object({ url: z.string(), method: z.string().optional(), headers: z.record(z.string()).optional(), body: z.string().optional() }),
  async (args) => {
    const response = await fetch(args.url, {
      method: args.method || 'GET',
      headers: args.headers || {},
      body: args.body,
      signal: AbortSignal.timeout(20000),
    });

    const contentType = response.headers.get('content-type') || '';
    let content: any;

    if (contentType.includes('json')) {
      content = await response.json();
    } else {
      content = (await response.text()).substring(0, 50000);
    }

    return {
      url: args.url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      content,
    };
  }
);

export default toolRegistry;
