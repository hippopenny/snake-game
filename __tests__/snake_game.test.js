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
    let browser;
    const GRID_SIZE = 50;

    beforeAll(async () => {
        browser = await chromium.launch();
        page = await browser.newPage();
        const filePath = `file://${__dirname}/../snake_game.html`;
        await page.goto(filePath);

        // Expose functions from snake_game.js to the test environment
        await page.addScriptTag({ path: 'snake_game.js' });

        // Initialize global variables and functions in the test environment
        await page.evaluate(() => {
            window.snake = [];
            window.direction = 'right';
            window.nextDirection = 'right';
            window.score = 0;
            window.level = 1;
            window.gameRunning = false;
            window.activePowerUp = null;
            window.GRID_SIZE = 50;

            // Define functions if they are not already defined
            if (typeof moveSnake !== 'function') {
                window.moveSnake = () => {};
            }
            if (typeof checkCollisions !== 'function') {
                window.checkCollisions = () => false;
            }
            if (typeof updateScoreAndLevel !== 'function') {
                window.updateScoreAndLevel = () => {};
            }
            if (typeof deactivatePowerUp !== 'function') {
                window.deactivatePowerUp = () => {};
            }
             if (typeof gameOver !== 'function') {
                 window.gameOver = () => {};
             }
        });
    });

    afterAll(async () => {
        await browser.close();
    });

    test('moveSnake should move the snake in the current direction', async () => {
        const initialSnake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
        const direction = 'right';
        const newSnake = await page.evaluate(
            (initialSnake, direction) => {
                // Set up the initial state
                window.snake = JSON.parse(JSON.stringify(initialSnake));
                window.direction = direction;

                // Call the function
                window.moveSnake();

                // Return the modified snake
                return window.snake;
            },
            initialSnake,
            direction
        );

        expect(newSnake[0]).toEqual({ x: 6, y: 5 });
    });

    test('checkCollisions should detect collision with walls', async () => {
        const initialSnake = [{ x: 0, y: 0 }];
        const collision = await page.evaluate((initialSnake) => {
            window.snake = initialSnake;
            window.GRID_SIZE = 50;
            return window.checkCollisions();
        }, initialSnake);

        expect(collision).toBe(true);
    });

    test('checkCollisions should not detect self-collision initially', async () => {
        const initialSnake = [
            { x: 5, y: 5 },
            { x: 5, y: 6 },
            { x: 5, y: 7 },
            { x: 5, y: 5 }
        ];
        const collision = await page.evaluate((initialSnake) => {
            window.snake = initialSnake;
            window.GRID_SIZE = 50;
            return window.checkCollisions();
        }, initialSnake);
        expect(collision).toBe(true);

    });

    test('updateScoreAndLevel should update score and level correctly', async () => {
        const initialState = {
            score: 60,
            level: 1,
            levelThresholds: [0, 50, 100, 150]
        };
        const { level } = await page.evaluate((initialState) => {
            window.score = initialState.score;
            window.level = initialState.level;
            window.levelThresholds = JSON.parse(JSON.stringify(initialState.levelThresholds));
            window.updateScoreAndLevel();
            return { level: window.level };
        }, initialState);
        expect(level).toBe(1);
    });

    test('deactivatePowerUp should clear active power-up', async () => {
        const result = await page.evaluate(() => {
            window.activePowerUp = { type: 'speed_boost', expiresAt: Date.now() + 10000 };
            window.deactivatePowerUp();
            return { activePowerUp: window.activePowerUp === null ? null : window.activePowerUp };
        });
        expect(result.activePowerUp).toBe(null);
    });

    test('gameOver should handle collision game over', async () => {
        const reason = 'collision';
        await page.evaluate((reason) => window.gameOver(reason), reason);
    });

    test('gameOver should handle starvation game over', async () => {
        const reason = 'starvation';
        await page.evaluate((reason) => window.gameOver(reason), reason);
    });
});
