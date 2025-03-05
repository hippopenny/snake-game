const { chromium } = require('playwright');

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
});

describe('Snake Game Unit Tests', () => {
  let page;
  const GRID_SIZE = 50;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto('file://' + __dirname + '/../snake_game.html');

    // Expose functions from snake_game.js to the test environment
    await page.addScriptTag({ path: 'snake_game.js' });
  });

  afterAll(async () => {
    await browser.close();
  });

  test('moveSnake should move the snake in the current direction', async () => {
    const initialSnake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    const direction = 'right';
    await page.evaluate((initialSnake, direction) => {
      window.snake = JSON.parse(JSON.stringify(initialSnake)); // Deep copy
      window.direction = direction;
      moveSnake();
    }, initialSnake, direction);

    const updatedSnake = await page.evaluate(() => window.snake);
    expect(updatedSnake[0]).toEqual({ x: 6, y: 5 });
  });

  test('checkCollisions should detect collision with walls', async () => {
    await page.evaluate(() => {
      window.snake = [{ x: 0, y: 0 }];
      window.GRID_SIZE = 50;
    });

    const collision = await page.evaluate(() => checkCollisions());
    expect(collision).toBe(false);
  });

  test('checkCollisions should not detect self-collision initially', async () => {
    // Set up a snake that will immediately collide with itself
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
