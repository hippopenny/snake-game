import { jest } from '@jest/globals';
import { chromium, devices } from 'playwright';
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
    consoleMessages = [];
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  });

  describe('Keyboard Controls', () => {
    beforeEach(async () => {
      consoleMessages = [];
      // Start the game
      await page.click('#start-btn');
      await page.waitForTimeout(500); // Wait for game to initialize
    });

    it('should change direction with arrow keys', async () => {
      await page.focus('#game-canvas'); // Ensure canvas is focused
      

      // Initial direction (right)
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(300);
      consoleMessages = [];
      expect(consoleMessages).toContain('direction: up');

      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      consoleMessages = [];
      expect(consoleMessages).toContain('direction: down');

      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: left');

      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: right');
    });

    it('should change direction with WASD keys', async () => {
      await page.focus('#game-canvas'); // Ensure canvas is focused

      // Initial direction (right)
      await page.keyboard.press('KeyW');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: up');

      await page.keyboard.press('KeyS');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: down');

      await page.keyboard.press('KeyA');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: left');

      await page.keyboard.press('KeyD');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: right');
    });
  });

  describe('Mobile Joystick Controls', () => {
    let mobilePage;

    beforeEach(async () => {
      consoleMessages = [];
      mobilePage = await browser.newPage({ ...devices['iPhone 13'] });
      mobilePage.on('console', msg => {
        consoleMessages.push(msg.text());
      });
      await mobilePage.goto('http://localhost:3000/snake_game.html');

      // Start the game
      await mobilePage.click('#start-btn');
      await mobilePage.waitForTimeout(500); // Wait for game to initialize
    });

    afterEach(async () => {
      if (mobilePage && !mobilePage.isClosed()) {
        await mobilePage.close();
      }
      consoleMessages = [];
    });

    it('should change direction with joystick controls', async () => {
      // Function to simulate touch events on the joystick
      async function simulateJoystickTouch(direction) {
        const joystickContainer = await mobilePage.$('#joystick-container');
        const boundingBox = await joystickContainer.boundingBox();
        const centerX = boundingBox.x + boundingBox.width / 2;
        const centerY = boundingBox.y + boundingBox.height / 2;

        let targetX = centerX;
        let targetY = centerY;

        switch (direction) {
          case 'up': targetY = boundingBox.y; break;
          case 'down': targetY = boundingBox.y + boundingBox.height; break;
          case 'left': targetX = boundingBox.x; break;
          case 'right': targetX = boundingBox.x + boundingBox.width; break;
        }

        await mobilePage.touchscreen.tap(targetX, targetY);
        await mobilePage.waitForTimeout(300);
      }

      await simulateJoystickTouch('up');
      await mobilePage.waitForFunction(() => consoleMessages.includes('direction: up'));
      expect(consoleMessages).toContain('direction: up');
      consoleMessages = [];

      await simulateJoystickTouch('down');
      await mobilePage.waitForFunction(() => consoleMessages.includes('direction: down'));
      expect(consoleMessages).toContain('direction: down');
      consoleMessages = [];

      await simulateJoystickTouch('left');
      await mobilePage.waitForFunction(() => consoleMessages.includes('direction: left'));
      expect(consoleMessages).toContain('direction: left');
      consoleMessages = [];

      await simulateJoystickTouch('right');
      await mobilePage.waitForFunction(() => consoleMessages.includes('direction: right'));
      expect(consoleMessages).toContain('direction: right');
    });
  });
});
