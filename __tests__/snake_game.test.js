import { chromium } from 'playwright';
import '@playwright/test';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.setTimeout(30000); // Increase Jest timeout to 30 seconds

describe('Snake Game Integration Tests', () => {
  let browser;
  let page;
  let server;
  let wss;
  let consoleMessages = [];
  let pageErrors = [];

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
    }).listen(3000, () => {
      console.log('HTTP server listening on port 3000');
    });

    // Create WebSocket server
    wss = new WebSocketServer({ server });
    wss.on('error', error => {
      console.error('WebSocket server error:', error);
    });

    browser = await chromium.launch();
    page = await browser.newPage();

    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    page.on('websocket', ws => {
      ws.on('close', () => {
        console.log('WebSocket disconnected');
      });
    });

    // Wait for WebSocket to connect before running tests
    await page.waitForFunction(() => {
      console.log('WebSocket state:', window.socket ? window.socket.readyState : 'No socket');
      return window.socket && window.socket.readyState === WebSocket.OPEN;
    }, { timeout: 10000 });
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
      window.players = {};
    });
    await page.click('#start-btn');
    await page.waitForTimeout(100); // Short delay to allow the game to initialize
  });

  test('should display the start screen', async () => {
    await page.waitForSelector('#start-screen', { visible: true });
  });

  test('should start the game when start button is clicked', async () => {
    await page.waitForSelector('#game-canvas', { visible: true });
    expect(await page.evaluate(() => window.gameRunning)).toBe(true);
  });

  test('should move snake in response to arrow keys', async () => {
    await page.focus('#game-canvas');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window.direction === 'up');
    expect(await page.evaluate(() => window.direction)).toBe('up');
  });

  test('should increase score when food is eaten', async () => {
    // Place food near the snake's starting position
    await page.evaluate(() => {
      window.foods = [{ x: 6, y: 5, color: 'red', createdAt: Date.now(), lifetime: 5000 }];
    });

    const initialScore = await page.evaluate(() => window.score);

    // Function to check if the snake has eaten the food
    const hasEatenFood = async () => {
      const head = await page.evaluate(() => window.snake[0]);
      return head.x === 6 && head.y === 5;
    };

    // Move the snake until it eats the food
    while (!(await hasEatenFood())) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100); // Short delay to allow the game to update
    }

    // Wait for the score to increase
    await expect.poll(async () => await page.evaluate(() => window.score), {
      timeout: 1000,
      intervals: [100]
    }).toBeGreaterThan(initialScore);
  });

  test('should end game on wall collision', async () => {
    // Set snake near the wall
    await page.evaluate(() => {
      window.snake = [{ x: 0, y: 5 }];
      window.direction = 'left';
    });

    // Wait for the game to end
    await expect.poll(async () => await page.evaluate(() => window.gameRunning), {
      timeout: 2000,
      intervals: [200]
    }).toBe(false);
  });

  test('should end game on self collision', async () => {
    // Set up a snake that will collide with itself after a few moves
    await page.evaluate(() => {
      window.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }];
      window.direction = 'up';
      window.nextDirection = 'right';
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
      }));
    }, testPlayer);

    // Wait for the player to be added
    await page.waitForFunction((playerId) => !!window.players[playerId], { timeout: 1000 }, testPlayer.id);

    // Verify that the player data has been updated in the game
    const snakeX = await page.evaluate((playerId) => {
      if (window.players[playerId] && window.players[playerId].snake.length > 0) {
        return window.players[playerId].snake[0].x;
      }
      return null;
    }, testPlayer.id);
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
    await page.waitForFunction(() => window.activePowerUp && window.activePowerUp.type === 'speed_boost', { timeout: 1000 });

    // Verify that the game speed has increased
    const boostedGameSpeed = await page.evaluate(() => window.gameSpeed);
    expect(boostedGameSpeed).toBeLessThan(initialGameSpeed);

    // Wait for the power-up to expire
    await page.waitForTimeout(2500);

    // Verify that the game speed has returned to normal
    expect(await page.evaluate(() => window.gameSpeed)).toBe(initialGameSpeed);
  });

  test('should receive and process game state updates from the server', async () => {
    // Define a test game state
    const gameState = {
      type: 'state',
      players: {
        'test-player': {
          id: 'test-player',
          snake: [{ x: 2, y: 2 }, { x: 1, y: 2 }],
          score: 5,
          level: 1,
        },
      },
      foods: [{ x: 7, y: 8, color: 'blue', createdAt: Date.now(), lifetime: 5000 }],
    };

    // Send the game state to the client
    await page.evaluate((gameState) => {
      window.socket.send(JSON.stringify(gameState));
    }, gameState);

    // Wait for the player data to be updated
    await page.waitForFunction(() => {
      const player = window.players['test-player'];
      return player && player.snake[0].x === 2 && player.snake[0].y === 2;
    }, { timeout: 1000 });

    // Verify that the player data has been updated in the game
    const playerSnake = await page.evaluate(() => window.players['test-player'].snake);
    expect(playerSnake).toEqual([{ x: 2, y: 2 }, { x: 1, y: 2 }]);

    // Verify that the food data has been updated in the game
    const foods = await page.evaluate(() => window.foods);
    expect(foods).toEqual([{ x: 7, y: 8, color: 'blue', createdAt: expect.any(Number), lifetime: 5000 }]);
  });
});
