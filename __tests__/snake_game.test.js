import { jest } from '@jest/globals';
import { chromium } from 'playwright';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Snake Game Tests', () => {
  let browser;
  let page;
  let httpServer;
  let consoleMessages = [];

  beforeAll(async () => {
    jest.setTimeout(30000);

    // Start HTTP server
    httpServer = createServer((req, res) => {
      console.log(`Request for: ${req.url}`);
      const filePath = req.url === '/' ? '/snake_game.html' : req.url;
      if (filePath.includes('snake_game.html') || filePath.includes('snake_game.js')) {
        const fullPath = path.join(__dirname, '..', filePath);
        const contentType = filePath.endsWith('.html') ? 'text/html' : 'application/javascript';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(fullPath).pipe(res);
      }
    }).listen(3000);
    console.log('Server started');
    // Launch browser
    browser = await chromium.launch({
      headless: false,      
      args: ['--no-sandbox'],
      slowMo: 100 });
  });

  beforeEach(async () => {
    page = await browser.newPage();
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });
    await page.goto('http://localhost:3000/snake_game.html');
  });

  afterEach(async () => {
    if (page && !page.isClosed()) {
      await page.close();
    }
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  });

});
