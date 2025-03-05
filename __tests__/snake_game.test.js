import { chromium } from 'playwright';
import '@playwright/test';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Snake Game Integration Tests', () => {
  let browser;
  let page;
  let server;
  let wss;
  let consoleMessages = [];

  beforeAll(async () => {
    // Create HTTP server
    server = createServer((req, res) => {
      if (req.url === '/snake_game.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(path.join(__dirname, '../snake_game.html')).pipe(res);
      } else if (req.url === '/snake_game.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        fs.createReadStream(path.join(__dirname, '../snake_game.js')).pipe(res);
      }
    }).listen(3000);

    // Create WebSocket server
    wss = new WebSocketServer({ server });

    browser = await chromium.launch();
    page = await browser.newPage();
    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });
    await page.goto('http://localhost:3000/snake_game.html');

    // Wait for WebSocket to connect before running tests
    await page.waitForEvent('websocket', { timeout: 3000 });
  });

  afterAll(async () => {
    await browser.close();
    server.close();
    wss.close();
  });

  beforeEach(async () => {
    consoleMessages = []; // Clear console messages before each test
    await page.evaluate(() => {
      // Reset game state before each test
      window.snake = [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 }
      ];
      window.direction = 'right';
      window.nextDirection = 'right';
      window.score = 0;
      window.level = 1;
      window.gameRunning = false;
      window.foods = [];
      window.activePowerUp = null;
    });
    await page.click('#start-btn');
  });

  test('should display the start screen', async () => {
    const startScreen = await page.$('#start-screen');
    expect(await startScreen.isVisible()).toBe(true);
  });

  test('should start the game when start button is clicked', async () => {
    const gameCanvas = await page.$('#game-canvas');
    expect(await gameCanvas.isVisible()).toBe(true);
    expect(await page.evaluate(() => window.gameRunning)).toBe(true);
  });

  test('should move snake in response to arrow keys', async () => {
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => window.direction)).toBe('up');
  });

  test('should increase score when food is eaten', async () => {
    // Mock food position to be next to the snake
    await page.evaluate(() => {
      window.foods = [{ x: 6, y: 5, color: 'red', createdAt: Date.now(), lifetime: 5000 }];
    });

    // Get initial score
    let initialScore = await page.evaluate(() => window.score);

    // Move the snake towards the food.
    await page.keyboard.press('ArrowRight');

    // Wait for the score to increase
    await expect.poll(async () => await page.evaluate(() => window.score), {
      timeout: 1000,
      intervals: [100]
    }).toBeGreaterThan(initialScore);
  });

  test('should end game on wall collision', async () => {
    // Move the snake to the left until it collides with the wall
    await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowLeft');
    }

    // Wait for the game to end
    await expect.poll(async () => await page.evaluate(() => window.gameRunning), {
      timeout: 2000,
      intervals: [200]
    }).toBe(false);
  });

  test('should end game on self collision', async () => {
    // Make the snake long enough to collide with itself
    await page.evaluate(() => {
      window.snake = [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
        { x: 5, y: 5 } // Head collides with tail
      ];
    });

    // Wait for the game to end
    await expect.poll(async () => await page.evaluate(() => window.gameRunning), {
      timeout: 2000,
      intervals: [200]
    }).toBe(false);
  });

  test('should handle WebSocket player updates and draw other players', async () => {
    const testPlayer = {
      id: 'test-id',
      snake: [{ x: 10, y: 10 }],
      score: 100,
      level: 1
    };
    // Send player data to the game via WebSocket
    await page.evaluate(async (player) => {
      window.socket.send(JSON.stringify({
        type: 'state',
        players: { [player.id]: player },
        foods: [],
        score: player.score
      }));
    }, testPlayer);

    // Wait for a short time to allow the game to process the update
    await page.waitForTimeout(200);

    // Verify that the player data has been updated in the game
    const snakeX = await page.evaluate(() => {
      if (window.players['test-id'] && window.players['test-id'].snake.length > 0) {
        return window.players['test-id'].snake[0].x;
      }
      return null;
    });
    expect(snakeX).toBe(10);
  });

  test('should log WebSocket connection established', async () => {
    const expectedMessage = 'WebSocket connection established. Player ID:';
    await expect.poll(() => consoleMessages.some(msg => msg.includes(expectedMessage)), {
      timeout: 1000,
      intervals: [100]
    }).toBe(true);
  });

  test('should log WebSocket error', async () => {
    // Simulate WebSocket error
    await page.evaluate(() => {
      window.socket.onerror({ message: 'Simulated WebSocket error' });
    });
    const expectedMessage = 'WebSocket error: Simulated WebSocket error';
    await expect.poll(() => consoleMessages.some(msg => msg.includes(expectedMessage)), {
      timeout: 1000,
      intervals: [200]
    }).toBe(true);
  });

  test('should apply speed boost power-up effect', async () => {
    // Mock the food array to include a speed_boost power-up
    await page.evaluate(() => {
      window.foods = [
        {
          x: 6,
          y: 5,
          color: 'red',
          powerUp: true,
          type: 'speed_boost',
          createdAt: Date.now(),
          lifetime: 2000 // Short lifetime for testing
        }
      ];
    });

    // Get initial game speed
    const initialGameSpeed = await page.evaluate(() => window.gameSpeed);

    // Move the snake towards the food
    await page.keyboard.press('ArrowRight');

    // Wait for the power-up to be applied
    await expect.poll(async () => await page.evaluate(() => window.activePowerUp && window.activePowerUp.type === 'speed_boost'), {
      timeout: 1000,
      intervals: [100]
    }).toBe(true);

    // Verify that the game speed has increased
    const boostedGameSpeed = await page.evaluate(() => window.gameSpeed);
    expect(boostedGameSpeed).toBeLessThan(initialGameSpeed);

    // Wait for the power-up to expire
    await page.waitForTimeout(2500);

    // Verify that the game speed has returned to normal
    expect(await page.evaluate(() => window.gameSpeed)).toBe(initialGameSpeed);
  });
});
