import math
import numpy as np
import gymnasium as gym
from gymnasium import spaces

class CarMouseEnv(gym.Env):
    """
    2D kinematic bicycle car tries to follow a moving target.

    Observation (float32, shape (5,)):
        [x_rel, y_rel, vx_rel, vy_rel, v]
        where rel quantities are in the CAR BODY frame.

    Action (float32, shape (2,), range [-1, 1]):
        a[0]: steering command -> steer angle delta in [-max_steer, max_steer]
        a[1]: accel command   -> acceleration in [-max_decel, max_accel]

    Episode length: 1000 steps by default (dt=0.02 -> ~20s)
    """

    metadata = {"render_modes": []}

    def __init__(self, seed: int | None = None, world_size: tuple[float,float]=(800.0, 600.0)):
        super().__init__()
        self.rng = np.random.default_rng(seed)
        self.W, self.H = world_size
        # Car params
        self.L = 48.0
        self.max_steer = 0.6  # rad (~34 deg)
        self.max_accel = 500.0
        self.max_decel = 600.0
        self.dt = 0.02
        self.drag = 0.995

        # Target dynamics (random-walk velocity, reflected at borders)
        self.tgt_max_speed = 240.0
        self.tgt_accel_std = 500.0

        # Spaces
        high_obs = np.array([np.finfo(np.float32).max]*5, dtype=np.float32)
        self.observation_space = spaces.Box(-high_obs, high_obs, dtype=np.float32)
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(2,), dtype=np.float32)

        self.reset()

    # -------- helpers
    @staticmethod
    def _wrap_angle(a: float) -> float:
        while a > math.pi: a -= 2*math.pi
        while a < -math.pi: a += 2*math.pi
        return a

    def _world_to_body(self, dx, dy, yaw):
        c, s = math.cos(yaw), math.sin(yaw)
        # rotate world vector into car frame
        x_b =  c*dx + s*dy
        y_b = -s*dx + c*dy
        return x_b, y_b

    # -------- gym API
    def reset(self, *, seed: int | None = None, options=None):
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        # car state
        self.x = self.rng.uniform(0, self.W)
        self.y = self.rng.uniform(0, self.H)
        self.yaw = self.rng.uniform(-math.pi, math.pi)
        self.v = 0.0
        self.delta = 0.0

        # target state
        self.tx = self.rng.uniform(0, self.W)
        self.ty = self.rng.uniform(0, self.H)
        angle = self.rng.uniform(-math.pi, math.pi)
        speed = self.rng.uniform(60.0, 180.0)
        self.tvx = speed * math.cos(angle)
        self.tvy = speed * math.sin(angle)

        self.t = 0
        obs = self._get_obs()
        return obs, {}

    def _get_obs(self):
        # relative position and velocity in car frame
        dx = self.tx - self.x
        dy = self.ty - self.y
        vx_rel_w = self.tvx - self.v*math.cos(self.yaw)
        vy_rel_w = self.tvy - self.v*math.sin(self.yaw)
        x_rel, y_rel = self._world_to_body(dx, dy, self.yaw)
        vx_rel, vy_rel = self._world_to_body(vx_rel_w, vy_rel_w, self.yaw)
        return np.array([x_rel, y_rel, vx_rel, vy_rel, self.v], dtype=np.float32)

    def step(self, action):
        a0 = float(np.clip(action[0], -1.0, 1.0))
        a1 = float(np.clip(action[1], -1.0, 1.0))

        # map to physical commands
        delta_cmd = a0 * self.max_steer
        accel_cmd = a1 * self.max_accel  # negative values allow braking
        if accel_cmd < 0:
            accel_cmd = max(accel_cmd, -self.max_decel)

        # integrate bicycle model
        self.x += self.v * math.cos(self.yaw) * self.dt
        self.y += self.v * math.sin(self.yaw) * self.dt
        self.yaw += (self.v / self.L) * math.tan(delta_cmd) * self.dt
        self.yaw = self._wrap_angle(self.yaw)
        self.v += accel_cmd * self.dt
        self.v *= self.drag

        # update target (random acceleration, reflect at bounds)
        self.tvx += self.rng.normal(0.0, self.tgt_accel_std) * self.dt
        self.tvy += self.rng.normal(0.0, self.tgt_accel_std) * self.dt
        sp = math.hypot(self.tvx, self.tvy)
        if sp > self.tgt_max_speed:
            self.tvx *= self.tgt_max_speed / sp
            self.tvy *= self.tgt_max_speed / sp
        self.tx += self.tvx * self.dt
        self.ty += self.tvy * self.dt

        # reflect target and car at borders
        def reflect(pos, vel, lo, hi):
            if pos < lo: pos, vel = lo + (lo - pos), abs(vel)
            if pos > hi: pos, vel = hi - (pos - hi), -abs(vel)
            return pos, vel
        self.tx, self.tvx = reflect(self.tx, self.tvx, 0.0, self.W)
        self.ty, self.tvy = reflect(self.ty, self.tvy, 0.0, self.H)
        self.x, _ = reflect(self.x, 0.0, 0.0, self.W)
        self.y, _ = reflect(self.y, 0.0, 0.0, self.H)

        obs = self._get_obs()

        # reward shaping
        x_rel, y_rel, vx_rel, vy_rel, v = obs
        dist = math.hypot(x_rel, y_rel)
        heading_err = abs(math.atan2(y_rel, x_rel))
        r = -0.30 * dist - 0.05 * (heading_err**2) - 0.001 * (a0*a0 + a1*a1)
        if dist < 15.0:
            r += 1.0  # small bonus near the cursor

        self.t += 1
        done = self.t >= 1000  # ~20s
        info = {"dist": dist}
        return obs, r, done, False, info
