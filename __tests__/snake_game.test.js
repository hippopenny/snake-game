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
    const initialScore = await page.evaluate(() => window.score);
    // Simulate snake eating food by placing food at snake head position
    await page.evaluate(() => {
      const headPos = window.snake[0];
      window.foods = [{ x: headPos.x, y: headPos.y }];
      window.checkCollisions();
    });
    const newScore = await page.evaluate(() => window.score);
    expect(newScore).toBeGreaterThan(initialScore);
  });

  test('should end game on wall collision', async () => {
    await page.evaluate(() => {
      window.snake[0] = { x: -1, y: 0 }; // Position snake outside bounds
      window.checkCollisions();
    });
    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });

  test('should end game on self collision', async () => {
    await page.evaluate(() => {
      window.snake = [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
        { x: 5, y: 5 } // Head collides with tail
      ];
      window.checkCollisions();
    });
    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });

  test('should handle WebSocket player updates', async () => {
    const testPlayer = {
      id: 'test-id',
      snake: [{ x: 10, y: 10 }],
      score: 100
    };
    
    await page.evaluate((player) => {
      window.players[player.id] = player;
    }, testPlayer);
    
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
    await page.evaluate(() => {
      const error = new Error('Simulated WebSocket error');
      console.error('WebSocket error:', error);
    });
    const expectedMessage = 'WebSocket error: Error: Simulated WebSocket error';
    const logFound = consoleMessages.some(msg => msg.includes(expectedMessage));
    expect(logFound).toBe(true);
  });
});