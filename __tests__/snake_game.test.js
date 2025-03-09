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
      // Start the game
      await page.click('#start-btn');
      await page.waitForTimeout(500); // Wait for game to initialize
    });

    it('should change direction with arrow keys', async () => {
      await page.focus('#game-canvas');

      // Start by pressing a key to ensure a different initial direction
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(300);

      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: left');

      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: down');

      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: right');
    });

    it('should change direction with WASD keys', async () => {
      await page.focus('#game-canvas');

      // Start by pressing a key to ensure a different initial direction
      await page.keyboard.press('KeyW');
      await page.waitForTimeout(300);

      await page.keyboard.press('KeyA');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: left');

      await page.keyboard.press('KeyS');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: down');

      await page.keyboard.press('KeyD');
      await page.waitForTimeout(300);
      expect(consoleMessages).toContain('direction: right');
    });
  });

  describe('Mobile Joystick Controls', () => {
    let mobilePage;

    beforeEach(async () => {
      mobilePage = await browser.newPage({ ...devices['iPhone 13'] });
      mobilePage.on('console', msg => {
        consoleMessages.push(msg.text());
      });
      await mobilePage.goto('http://localhost:3000/snake_game.html');

      // Start the game
      await mobilePage.click('#start-btn');
      await mobilePage.waitForTimeout(500); // Wait for game to initialize

      // Verify the joystick is visible by checking its display style
      const joystickVisible = await mobilePage.evaluate(() => {
        const joystickContainer = document.getElementById('joystick-container');
        return joystickContainer && window.getComputedStyle(joystickContainer).display !== 'none';
      });
      expect(joystickVisible).toBeTruthy();
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
          case 'left': targetX = boundingBox.x; break;
          case 'down': targetY = boundingBox.y + boundingBox.height; break;
          case 'right': targetX = boundingBox.x + boundingBox.width; break;
        }

        console.log(`Tapping ${direction} at ${targetX}, ${targetY}`);
        await mobilePage.touchscreen.tap(targetX, targetY);
        await mobilePage.waitForTimeout(300);
      }

      const waitForDirection = async (expectedDirection) => {
        await mobilePage.waitForFunction(
          (dir, currentDir) => {
            return window.nextDirection === dir && window.direction !== dir;
          },
          expectedDirection,
          { timeout: 15000 } // Increased timeout to 15 seconds
        );
      };

      await simulateJoystickTouch('up');
      await waitForDirection('up');
      expect(await mobilePage.evaluate(() => window.nextDirection)).toBe('up');

      await simulateJoystickTouch('left');
      await waitForDirection('left');
      expect(await mobilePage.evaluate(() => window.nextDirection)).toBe('left');

      await simulateJoystickTouch('down');
      await waitForDirection('down');
      expect(await mobilePage.evaluate(() => window.nextDirection)).toBe('down');

      await simulateJoystickTouch('right');
      await waitForDirection('right');
      expect(await mobilePage.evaluate(() => window.nextDirection)).toBe('right');
    });
  });
});
