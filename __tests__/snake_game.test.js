const { moveSnake, checkCollisions, updateScoreAndLevel } = require('../snake_game');

describe('Snake Game Tests', () => {
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

  test('moveSnake should move the snake in the current direction', () => {
    moveSnake(snake, direction);
    expect(snake[0]).toEqual({ x: 6, y: 5 });
  });

  test('checkCollisions should detect collision with walls', () => {
    snake[0] = { x: GRID_SIZE, y: 5 }; // Position head at the edge
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
});
