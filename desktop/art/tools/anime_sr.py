"""Optional local anime SR. PyTorch and weights are local build dependencies only.
Run the pose builder with python -I; load weights with weights_only=True. Never
fetch/execute model repositories automatically or bundle weights with a pack.
"""
import numpy as np
from PIL import Image, ImageFilter


def restorer(weights, soften=0.25):
    import torch
    from torch import nn
    class AnimeVGG(nn.Module):
        def __init__(self):
            super().__init__()
            layers = [nn.Conv2d(3, 64, 3, 1, 1), nn.PReLU(64)]
            for _ in range(16):
                layers += [nn.Conv2d(64, 64, 3, 1, 1), nn.PReLU(64)]
            layers += [nn.Conv2d(64, 48, 3, 1, 1)]
            self.body = nn.ModuleList(layers)
            self.upsampler = nn.PixelShuffle(4)
        def forward(self, x):
            y = x
            for layer in self.body:
                y = layer(y)
            return self.upsampler(y) + nn.functional.interpolate(x, scale_factor=4, mode='nearest')
    model = AnimeVGG()
    model.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True)['params'])
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    model = model.eval().to(device)
    def restore(im, size):
        a = np.asarray(im.convert('RGBA'), dtype=np.float32) / 255
        rgb = a[..., :3] * a[..., 3:] + .5 * (1 - a[..., 3:])
        x = torch.from_numpy(rgb).permute(2, 0, 1)[None].to(device)
        with torch.inference_mode():
            rgb = model(x).clamp_(0, 1).cpu().numpy()[0].transpose(1, 2, 0)
        result = Image.fromarray((rgb * 255).round().astype('uint8')).resize(size, Image.Resampling.LANCZOS)
        if soften:
            result = result.filter(ImageFilter.GaussianBlur(soften))
        result.putalpha(im.getchannel('A').resize(size, Image.Resampling.LANCZOS))
        return result
    return restore
