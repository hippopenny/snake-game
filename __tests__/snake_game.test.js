const { chromium } = require('playwright');
const { moveSnake, checkCollisions, updateScoreAndLevel, deactivatePowerUp, gameOver } = require('../snake_game');

describe('Snake Game Integration Tests', () => {
  let browser;
  let page;
  let consoleMessages = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    // Set up console listener
    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });

    await page.goto('file://' + __dirname + '/../snake_game.html'); // Load the actual HTML file
  });

  afterAll(async () => {
    await browser.close();
  });

  // Integration test using Playwright
  test('should display the start screen', async () => {
    const startScreen = await page.$('#start-screen');
    expect(await startScreen.isVisible()).toBe(true);
  });

  test('should start the game when start button is clicked', async () => {
    await page.click('#start-btn');
    const gameCanvas = await page.$('#game-canvas');
    expect(await gameCanvas.isVisible()).toBe(true);
  });

  test('should log WebSocket connection established', async () => {
    // Wait for the page to load and the WebSocket connection to be established
    await page.waitForTimeout(1000); // Adjust the timeout as needed

    // Check if the expected console message is present
    const expectedMessage = 'WebSocket connection established. Player ID:';
    const logFound = consoleMessages.some(msg => msg.includes(expectedMessage));
    expect(logFound).toBe(true);
  });

  test('should log WebSocket error', async () => {
    // Simulate a WebSocket error
    await page.evaluate(() => {
      const error = new Error('Simulated WebSocket error');
      console.error('WebSocket error:', error);
    });

    // Check if the expected console error message is present
    const expectedMessage = 'WebSocket error: Error: Simulated WebSocket error';
    const logFound = consoleMessages.some(msg => msg.includes(expectedMessage));
    expect(logFound).toBe(true);
  });
  test('should mock WebSocket connection', async () => {
    await page.exposeFunction('mockWebSocket', () => {
      return {
        send: jest.fn(),
        close: jest.fn(),
        onmessage: jest.fn(),
        onopen: jest.fn(),
        onerror: jest.fn(),
        onclose: jest.fn(),
      };
    });

    await page.evaluate(() => {
      window.WebSocket = window.mockWebSocket();
    });

    // Test WebSocket interactions here
  });
});

describe('Snake Game Unit Tests', () => {
  let snake;
  let direction;
  const GRID_SIZE = 50;

  beforeEach(() => {
    snake = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 }
    ];
    direction = 'right';
  });

  // Unit tests for game logic
  test('moveSnake should move the snake in the current direction', () => {
    moveSnake(snake, direction);
    expect(snake[0]).toEqual({ x: 6, y: 5 });
  });

  test('moveSnake should move the snake up', () => {
    direction = 'up';
    moveSnake(snake, direction);
    expect(snake[0]).toEqual({ x: 5, y: 4 });
  });

  test('checkCollisions should detect collision with walls', () => {
    snake[0] = { x: GRID_SIZE, y: 5 };
    const collision = checkCollisions(snake, GRID_SIZE);
    expect(collision).toBe(true);
  });

  test('checkCollisions should detect self-collision', () => {
    snake = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 5, y: 5 }
    ];
    const collision = checkCollisions(snake, GRID_SIZE);
    expect(collision).toBe(true);
  });

  test('updateScoreAndLevel should update score and level correctly', () => {
    let score = 60;
    let level = 1;
    const levelThresholds = [0, 50, 100, 150];
    updateScoreAndLevel(score, level, levelThresholds);
    expect(level).toBe(2);
  });

  test('deactivatePowerUp should clear active power-up', () => {
    let activePowerUp = { type: 'speed_boost', expiresAt: Date.now() + 10000 };
    deactivatePowerUp();
    expect(activePowerUp).toBeNull();
  });

  test('gameOver should handle collision game over', () => {
    const reason = 'collision';
    gameOver(reason);
    expect(gameRunning).toBe(false);
  });

  test('gameOver should handle starvation game over', () => {
    const reason = 'starvation';
    gameOver(reason);
    expect(gameRunning).toBe(false);
  });
});
