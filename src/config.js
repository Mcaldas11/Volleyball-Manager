// Logical resolution is 16:9 so the FIT scale fills a widescreen monitor with no
// letterbox bars (the old 400x430 near-square canvas left big black side bars).
export const GAME_WIDTH = 768;
export const GAME_HEIGHT = 432;

// Horizon / sand split for the procedural backdrop.
export const SEA_Y = 150;
export const SAND_Y = 174;

// Court depth: the "up/down the screen" axis (side to side along the net,
// shared by both teams). This is also the screen-y band the court is drawn in.
export const COURT_DEPTH = { min: 210, max: 420 };
export const COURT_DEPTH_OUTER = { min: COURT_DEPTH.min, max: COURT_DEPTH.max };
export const MID_DEPTH = (COURT_DEPTH.min + COURT_DEPTH.max) / 2;

// Net
export const NET_X = GAME_WIDTH / 2; // 384
export const NET_PLAY_HEIGHT = 95; // ball/hands above this height (z) pass over the net
export const NET_TOUCH_RADIUS = 14;

// Keep a player body (~32px wide) fully on its own side: bounds are hard walls,
// which is what stops the avatar ever crossing to the other side of the net.
export const PLAYER_HALF_W = 16;
export const NET_MARGIN = 8;

// Outer sidelines (the painted court rectangle) - used for in/out calls.
export const COURT_OUTER = { min: 64, max: GAME_WIDTH - 64 }; // 64 .. 704

// Player movement bounds per physical side.
export const COURT = {
  left: { min: COURT_OUTER.min + 8, max: NET_X - PLAYER_HALF_W - NET_MARGIN }, // 72 .. 360
  right: { min: NET_X + PLAYER_HALF_W + NET_MARGIN, max: COURT_OUTER.max - 8 }, // 408 .. 696
};

// Where a server stands (behind their baseline, away from the net).
export const SERVE_SPOT = {
  left: { x: COURT.left.min + 26, y: MID_DEPTH },
  right: { x: COURT.right.max - 26, y: MID_DEPTH },
};

// Physics (z = height above the sand, positive up; gravity pulls vz down).
export const GRAVITY = 720;
export const PLAYER_SPEED = 185;
export const PLAYER_JUMP_SPEED = 310;

export const BALL_RADIUS = 8;
export const HIT_REACH = 32; // radial distance within which a player can play the ball
export const HIT_REACH_Z = 56; // vertical (height) window within which a player can play the ball
export const BLOCK_REACH = 40; // slightly longer reach at the net for blocks

// Official beach volleyball match rules
export const MAX_TOUCHES = 3;
export const SET_POINTS_NORMAL = 21;
export const SET_POINTS_DECIDER = 15;
export const WIN_MARGIN = 2;
export const SETS_TO_WIN = 2;
export const SWITCH_EVERY_NORMAL = 7;
export const SWITCH_EVERY_DECIDER = 5;

// Mouse charge-and-aim controls (human serve/attack)
export const MAX_CHARGE_TIME = 0.9;
export const MIN_CHARGE_POWER = 0.25;
export const MOUSE_HIT_MIN_APEX = 110;
export const MOUSE_HIT_MAX_APEX = 210;

// AI tuning
export const AI = {
  aimError: 16,
  setApex: 165,
  digApex: 150,
  spikeApex: 125,
  jumpReach: 1.5,
};

// Default customizable player appearance (overridden via the Customize screen,
// persisted in the Phaser registry).
export const DEFAULT_PLAYER = { name: 'TU', color: 0x4fc3f7 };
export const TEAM_A_PARTNER_COLOR = 0xffd8a8;
export const TEAM_B_COLORS = [0xff8a80, 0xb388ff];
