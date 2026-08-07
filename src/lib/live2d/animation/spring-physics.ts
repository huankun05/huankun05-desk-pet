export interface SpringState {
  position: number;
  velocity: number;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
  snapThreshold: number;
}

export function createSpringState(position: number = 0): SpringState {
  return {
    position,
    velocity: 0,
  };
}

export function updateSpring(
  state: SpringState,
  target: number,
  deltaTime: number,
  config: SpringConfig,
): number {
  const { stiffness, damping, mass, snapThreshold } = config;

  const pos = state.position;
  const vel = state.velocity;

  const springForce = stiffness * (target - pos);
  const dampingForce = -damping * vel;
  const accel = (springForce + dampingForce) / mass;

  state.velocity = vel + accel * deltaTime;
  state.position = pos + state.velocity * deltaTime;

  if (Math.abs(target - state.position) < snapThreshold && Math.abs(state.velocity) < snapThreshold) {
    state.position = target;
    state.velocity = 0;
  }

  return state.position;
}

// 对齐 AIRI 的弹簧参数（stiffness=120, damping=16, mass=1）
export const HEAD_SPRING_CONFIG: SpringConfig = {
  stiffness: 120,
  damping: 16,
  mass: 1,
  snapThreshold: 0.01,
};

// 身体跟随头部，但比头部略柔和（仍明显跟手，不再拖沓）
export const BODY_SPRING_CONFIG: SpringConfig = {
  stiffness: 95,
  damping: 13,
  mass: 1.0,
  snapThreshold: 0.01,
};