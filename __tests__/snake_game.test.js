const { chromium } = require('playwright');

describe('Snake Game UI Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto('file://' + __dirname + '/../snake_game.html'); // Load the actual HTML file
  });

  afterAll(async () => {
    await browser.close();
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

  // Mock WebSocket
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
