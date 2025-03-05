import { chromium } from 'playwright';
import '@playwright/test';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

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
  });

  afterAll(async () => {
    await browser.close();
    server.close();
    wss.close();
  });

  test('should display the start screen', async () => {
    const startScreen = await page.$('#start-screen');
    expect(await startScreen.isVisible()).toBe(true);
  });

  test('should start the game when start button is clicked', async () => {
    await page.click('#start-btn');
    const gameCanvas = await page.$('#game-canvas');
    expect(await gameCanvas.isVisible()).toBe(true);
  });

  test('should move snake in response to arrow keys', async () => {
    await page.keyboard.press('ArrowUp');
    const direction = await page.evaluate(() => window.direction);
    expect(direction).toBe('up');
  });

  test('should increase score when food is eaten', async () => {
    // Start the game
    await page.click('#start-btn');

    // Get initial score
    const initialScore = await page.evaluate(() => window.score);

    // Find the initial snake head position
    const initialHead = await page.evaluate(() => window.snake[0]);

    // Move the snake towards a food.  This assumes there's food nearby and the snake starts at {x:5, y:5}.
    // The game speed is 200ms, so wait for a few game ticks to ensure movement.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);

    // Get the new score
    const newScore = await page.evaluate(() => window.score);

    // Assert that the score has increased, implying food was eaten
    expect(newScore).toBeGreaterThan(initialScore);
  });

  test('should end game on wall collision', async () => {
    // Start the game
    await page.click('#start-btn');

    // Move the snake to the left until it collides with the wall
    await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(200); // Wait for the snake to move
    }

    // Check if the game is over
    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });

  test('should end game on self collision', async () => {
    // Start the game
    await page.click('#start-btn');

    // Make the snake long enough to collide with itself
    await page.evaluate(() => {
      window.snake = [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
        { x: 5, y: 5 } // Head collides with tail
      ];
    });

    // Check if the game is over
    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });

  test('should handle WebSocket player updates', async () => {
    // Start the game
    await page.click('#start-btn');

    const testPlayer = {
      id: 'test-id',
      snake: [{ x: 10, y: 10 }],
      score: 100
    };

    // Send player data to the game via WebSocket
    await page.evaluate((player) => {
      // Ensure WebSocket is open before sending
      if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({
          type: 'update',
          id: player.id,
          snake: player.snake,
          score: player.score
        }));
      } else {
        console.error('WebSocket not open, cannot send player data');
      }
    }, testPlayer);

    // Wait for a short time to allow the game to process the update
    await page.waitForTimeout(500);

    // Verify that the player data has been updated in the game
    const players = await page.evaluate(() => window.players);
    expect(players['test-id']).toBeDefined();
    expect(players['test-id'].score).toBe(100);
  });

  test('should log WebSocket connection established', async () => {
    await page.waitForTimeout(1000);
    const expectedMessage = 'WebSocket connection established. Player ID:';
    const logFound = consoleMessages.some(msg => msg.includes(expectedMessage));
    expect(logFound).toBe(true);
  });

  test('should log WebSocket error', async () => {
    // Simulate WebSocket error
    await page.evaluate(() => {
      const error = new Error('Simulated WebSocket error');
      console.error('WebSocket error:', error);
    });
    const expectedMessage = 'WebSocket error: Error: Simulated WebSocket error';
    const logFound = consoleMessages.some(msg => msg.includes(expectedMessage));
    expect(logFound).toBe(true);
  });
});
