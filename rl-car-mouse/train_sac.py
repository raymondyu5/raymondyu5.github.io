import argparse, os, pathlib
import numpy as np
import torch as th
from stable_baselines3 import SAC
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv
from stable_baselines3.common.callbacks import EvalCallback
from envs.car_mouse_env import CarMouseEnv

def make_env(seed, world):
    def _f():
        env = CarMouseEnv(seed=seed, world_size=world)
        return Monitor(env)
    return _f

def parse_net(s):
    return [int(x) for x in s.split(',')]

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--timesteps', type=int, default=300_000)
    p.add_argument('--vec', type=int, default=8)
    p.add_argument('--seed', type=int, default=0)
    p.add_argument('--lr', type=float, default=3e-4)
    p.add_argument('--net', type=parse_net, default='128,128')
    p.add_argument('--world', type=str, default='800,600')
    p.add_argument('--logdir', type=str, default='runs')
    p.add_argument('--models', type=str, default='models')
    args = p.parse_args()

    world = tuple(map(float, args.world.split(',')))
    os.makedirs(args.models, exist_ok=True)

    # Vec envs
    vec_cls = SubprocVecEnv if args.vec > 1 else DummyVecEnv
    env = vec_cls([make_env(args.seed + i, world) for i in range(args.vec)])
    eval_env = DummyVecEnv([make_env(12345, world)])

    policy_kwargs = dict(net_arch=args.net)
    model = SAC("MlpPolicy", env,
                learning_rate=args.lr,
                policy_kwargs=policy_kwargs,
                verbose=1,
                tensorboard_log=args.logdir,
                seed=args.seed)

    eval_cb = EvalCallback(eval_env, best_model_save_path=args.models,
                           log_path=args.models, eval_freq=5000,
                           deterministic=True, render=False)

    model.learn(total_timesteps=args.timesteps, callback=eval_cb)
    ckpt = os.path.join(args.models, 'sac_car')
    model.save(ckpt + '.zip')

    # ---- Export actor to ONNX (deterministic) and copy to web/ ----
    from export_onnx import export_actor_onnx
    onnx_out = os.path.join(args.models, 'sac_car_actor.onnx')
    export_actor_onnx(model, onnx_out)
    web_out = os.path.join('web', 'model.onnx')
    os.makedirs('web', exist_ok=True)
    import shutil
    shutil.copyfile(onnx_out, web_out)
    print(f"Exported ONNX to: {onnx_out} and copied to {web_out}")

if __name__ == '__main__':
    main()
