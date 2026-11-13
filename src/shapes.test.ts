import { expect, it } from 'vitest';
import { route, type Shape } from './shapes';

const arrow = (w: number, h: number, elbow = true): Shape => ({
  id: 'a',
  type: 'arrow',
  x: 0,
  y: 0,
  w,
  h,
  dotted: false,
  text: '',
  elbow,
});

it('bends a wide elbow arrow horizontally, vertically then horizontally at mid x', () => {
  expect(route(arrow(200, -100))).toEqual([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: -100 },
    { x: 200, y: -100 },
  ]);
});

it('bends a tall elbow arrow vertically, horizontally then vertically at mid y', () => {
  expect(route(arrow(-50, 300))).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 150 },
    { x: -50, y: 150 },
    { x: -50, y: 300 },
  ]);
});

it('keeps an elbow arrow straight when it is already level or upright', () => {
  expect(route(arrow(0, 80))).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 80 },
  ]);
  expect(route(arrow(80, 0))).toHaveLength(2);
});

it('routes a straight arrow end to end', () => {
  expect(route(arrow(200, 100, false))).toEqual([
    { x: 0, y: 0 },
    { x: 200, y: 100 },
  ]);
});
