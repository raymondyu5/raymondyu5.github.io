import argparse, os
import torch as th
from stable_baselines3 import SAC

class OnnxablePolicy(th.nn.Module):
    """Wrap SB3 SAC actor to make it ONNX-exportable.
    It returns **tanh-squashed actions in [-1,1]** (deterministic).
    """
    def __init__(self, actor: th.nn.Module):
        super().__init__()
        self.actor = actor

    def forward(self, observation: th.Tensor) -> th.Tensor:
        # SB3's SAC actor supports (obs, deterministic=True)
        return self.actor(observation, deterministic=True)

def export_actor_onnx(model_or_path, onnx_path: str, opset: int = 17):
    # Accept either a loaded model or a path to .zip
    if isinstance(model_or_path, str):
        model = SAC.load(model_or_path, device='cpu')
    else:
        model = model_or_path

    actor = model.policy.actor
    onnxable = OnnxablePolicy(actor).cpu().eval()
    obs_shape = model.observation_space.shape
    dummy = th.zeros(1, *obs_shape, dtype=th.float32)

    th.onnx.export(
        onnxable, dummy, onnx_path, opset_version=opset,
        input_names=["input"], output_names=["action"],
        dynamic_axes={"input": {0: "batch"}, "action": {0: "batch"}},
    )
    print(f"Saved ONNX actor to {onnx_path}")

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('model_zip', help='Path to SAC .zip checkpoint (from SB3)')
    ap.add_argument('onnx_out', help='Output ONNX path')
    ap.add_argument('--opset', type=int, default=17)
    args = ap.parse_args()
    export_actor_onnx(args.model_zip, args.onnx_out, args.opset)
