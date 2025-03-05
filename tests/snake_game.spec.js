const { test, expect } = require('@playwright/test');

test.describe('Snake Game', () => {

  test('Page Loads and has Title', async ({ page }) => {
    await page.goto('http://localhost:8080'); // Replace with your actual URL

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/Snake Game/); // Replace with your actual title
  });

    test('Game Starts', async ({ page }) => {
        await page.goto('http://localhost:8080'); // Replace with your actual URL

        // Assuming there's a start button with an id of 'startButton'
        await page.locator('#startButton').click();

        // Check if the game canvas is visible (assuming it has an id of 'gameCanvas')
        await expect(page.locator('#gameCanvas')).toBeVisible();

        // You might also want to check if the game is running by looking for changes
        // in the score or other game elements. This is highly dependent on your
        // specific implementation.  For example, if you have a score display
        // with id 'scoreDisplay':
        // const initialScore = await page.locator('#scoreDisplay').innerText();
        // await page.waitForTimeout(1000); // Wait for 1 second
        // const newScore = await page.locator('#scoreDisplay').innerText();
        // expect(parseInt(newScore)).toBeGreaterThan(parseInt(initialScore));
    });

    test('Snake Moves', async ({ page }) => {
        await page.goto('http://localhost:8080'); // Replace with your actual URL
        await page.locator('#startButton').click();

        // Get initial position of the snake.  This assumes you have a way to
        // get the snake's position, perhaps from a data attribute or by
        // analyzing the canvas. This is a placeholder and needs to be
        // adapted to your game's specifics.  Let's assume you add a
        // data-snake-x and data-snake-y attribute to the canvas.
        const initialX = await page.locator('#gameCanvas').getAttribute('data-snake-x');
        const initialY = await page.locator('#gameCanvas').getAttribute('data-snake-y');

        // Press the 'ArrowRight' key
        await page.keyboard.press('ArrowRight');

        // Wait for a short time to allow the snake to move
        await page.waitForTimeout(500); // Wait for 500ms. Adjust as needed.

        const newX = await page.locator('#gameCanvas').getAttribute('data-snake-x');
        const newY = await page.locator('#gameCanvas').getAttribute('data-snake-y');

        // Assert that the snake's position has changed.  This logic will
        // depend on your game's coordinate system and movement logic.
        expect(parseInt(newX)).toBeGreaterThan(parseInt(initialX));
        // expect(parseInt(newY)).toBe(parseInt(initialY)); // Assuming only horizontal movement
    });

    test('Game Over', async ({ page }) => {
        await page.goto('http://localhost:8080'); // Replace with your actual URL
        await page.locator('#startButton').click();

        // Force a game over condition. This is HIGHLY dependent on your game.
        // You might need to simulate key presses to make the snake collide
        // with itself or the wall.  Here's a very simplified example
        // assuming rapid up/down presses will cause a collision:

        for (let i = 0; i < 50; i++) {
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowDown');
        }

        // Check for a game over message (assuming you have an element with id 'gameOverMessage')
        await expect(page.locator('#gameOverMessage')).toBeVisible();

        // You might also check for the score to be reset or other game over indicators.
    });

    test('Food appears', async ({ page }) => {
        await page.goto('http://localhost:8080');
        await page.locator('#startButton').click();

        // Check if a food element is visible.  This assumes you have a way to
        // identify the food element, perhaps by a specific class or ID.
        // Let's assume a class 'food'.
        await expect(page.locator('.food')).toBeVisible();
    });
});

