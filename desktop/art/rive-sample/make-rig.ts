import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { Rig, Track } from '../tools/rive/writer.ts';
const root = new URL('./', import.meta.url);
const track = (target: string, property: string, values: [number, number][]): Track => ({
  target,
  property,
  keys: values.map(([frame, value]) => ({ frame, value, cubic: [0.42, 0, 0.58, 1] })),
});
const images: Rig['images'] = [];
function part(name: string, x: number, y: number, bone: string, opacity = 1): void {
  const p = PNG.sync.read(readFileSync(new URL(`parts/${name}.png`, root))),
    w = p.width,
    h = p.height;
  images.push({
    name,
    path: `parts/${name}.png`,
    width: w,
    height: h,
    x,
    y,
    opacity,
    mesh: {
      vertices: [
        [-w / 2, -h / 2, 0, 0],
        [w / 2, -h / 2, 1, 0],
        [w / 2, h / 2, 1, 1],
        [-w / 2, h / 2, 0, 1],
      ],
      triangles: [0, 1, 2, 0, 2, 3],
      bones: [bone],
    },
  });
}
part('tail', 128, 147, 'tailBone');
part('body', 96, 154, 'bodyBone');
part('ear-left', 61, 58, 'headBone');
part('ear-right', 131, 58, 'headBone');
part('head', 96, 96, 'headBone');
part('paw-left', 57, 149, 'bodyBone');
part('paw-right', 135, 149, 'bodyBone');
part('eyes', 96, 100, 'eyeBone');
part('eyes-closed', 96, 103, 'eyeBone', 0);
part('eyes-sleepy', 96, 103, 'eyeBone', 0);
images.find((p) => p.name === 'tail')!.mesh!.bones = ['tailBone', 'bodyBone'];
const tailHalf = images.find((p) => p.name === 'tail')!.width / 2;
for (let i = 0; i < 4; i++) part(`mouth${i}`, 96, 123, 'headBone', i === 0 ? 1 : 0);
const animations: Rig['animations'] = [];
function anim(name: string, duration: number, tracks: Track[], loop = false): void {
  animations.push({ name, duration, fps: 60, loop, tracks });
}
function pose(headY = 96, angle = 0): Track[] {
  return [
    track('headBone', 'y', [[0, headY]]),
    track('headBone', 'rotation', [[0, angle]]),
    track('bodyBone', 'scaleY', [[0, 1]]),
    track('bodyBone', 'y', [[0, 154]]),
    track('headBone', 'x', [[0, 96]]),
    track('eyes', 'opacity', [[0, 1]]),
    track('eyes-closed', 'opacity', [[0, 0]]),
    track('eyes-sleepy', 'opacity', [[0, 0]]),
  ];
}
anim(
  'idle',
  180,
  [
    ...pose(),
    track('bodyBone', 'scaleY', [
      [0, 1],
      [90, 1.025],
      [180, 1],
    ]),
    track('headBone', 'y', [
      [0, 96],
      [90, 94],
      [180, 96],
    ]),
    track('tailBone', 'rotation', [
      [0, -0.05],
      [90, 0.05],
      [180, -0.05],
    ]),
    track('tail.v2', 'x', [
      [0, tailHalf],
      [90, tailHalf + 2],
      [180, tailHalf],
    ]),
    track('eyes', 'opacity', [
      [0, 1],
      [145, 1],
      [150, 0],
      [157, 0],
      [162, 1],
      [180, 1],
    ]),
    track('eyes-closed', 'opacity', [
      [0, 0],
      [145, 0],
      [150, 1],
      [157, 1],
      [162, 0],
      [180, 0],
    ]),
    track('eyes-sleepy', 'opacity', [[0, 0]]),
  ],
  true,
);
anim(
  'running',
  60,
  [
    ...pose(),
    track('headBone', 'y', [
      [0, 96],
      [15, 90],
      [30, 96],
      [45, 92],
      [60, 96],
    ]),
    track('bodyBone', 'y', [
      [0, 154],
      [15, 151],
      [30, 154],
      [45, 151],
      [60, 154],
    ]),
  ],
  true,
);
anim('waiting', 120, [...pose(94, -0.09)], true);
anim('failed', 90, [...pose(103, 0.18)], false);
anim('review', 120, [...pose(96, -0.12)], true);
for (const name of ['sleeping', 'resting'])
  anim(
    name,
    180,
    [
      ...pose(103, 0.15),
      track('eyes', 'opacity', [[0, 0]]),
      track('eyes-closed', 'opacity', [[0, 1]]),
      track('eyes-sleepy', 'opacity', [[0, 0]]),
      track('bodyBone', 'scaleY', [
        [0, 0.96],
        [90, 1],
        [180, 0.96],
      ]),
    ],
    true,
  );
anim('bounce', 60, [
  ...pose(),
  track('headBone', 'y', [
    [0, 96],
    [18, 78],
    [35, 99],
    [48, 92],
    [60, 96],
  ]),
  track('bodyBone', 'y', [
    [0, 154],
    [18, 136],
    [35, 157],
    [48, 150],
    [60, 154],
  ]),
]);
for (let i = 0; i < 4; i++)
  anim(
    `mouth-${i}`,
    1,
    Array.from({ length: 4 }, (_, j) => track(`mouth${j}`, 'opacity', [[0, i === j ? 1 : 0]])),
  );
for (const axis of ['X', 'Y'])
  for (const value of [-1, 1])
    anim(`look${axis}${value}`, 1, [
      track('eyeBone', axis === 'X' ? 'x' : 'y', [[0, (axis === 'X' ? 0 : 4) + value * 4]]),
    ]);
const inputs: Rig['stateMachine']['inputs'] = [
  ...['state', 'mouth', 'lookX', 'lookY', 'dock'].map((name) => ({ name, type: 'number' as const })),
  { name: 'dragging', type: 'bool' },
  ...['complete', 'fail', 'poke', 'dragStart', 'land', 'wave'].map((name) => ({
    name,
    type: 'trigger' as const,
  })),
];
const states: Rig['stateMachine']['layers'][number]['states'] = [
  { name: 'entry', kind: 'entry', transitions: [{ to: 'idle' }] },
  {
    name: 'any',
    kind: 'any',
    transitions: [
      ...['complete', 'poke', 'land', 'wave'].map((input) => ({ to: 'bounce', conditions: [{ input }] })),
      { to: 'failed', conditions: [{ input: 'fail' }] },
    ],
  },
  { name: 'exit', kind: 'exit' },
];
const names = ['idle', 'running', 'waiting', 'failed', 'review', 'sleeping', 'resting'];
for (const name of names)
  states.push({
    name,
    animation: name,
    transitions: names
      .filter((n) => n !== name)
      .map((to) => ({
        to,
        duration: 160,
        ...(name === 'failed' ? { exitTime: 1500 } : {}),
        conditions: [{ input: 'state', value: names.indexOf(to) }],
      })),
  });
states.push({
  name: 'bounce',
  animation: 'bounce',
  transitions: names.map((to, i) => ({ to, exitTime: 1000, conditions: [{ input: 'state', value: i }] })),
});
const layers: Rig['stateMachine']['layers'] = [{ name: 'body', states }];
for (const [name, vals] of [
  ['mouth', [0, 0.33, 0.67, 1]],
  ['lookX', [-1, 1]],
  ['lookY', [-1, 1]],
] as const)
  layers.push({
    name,
    states: [
      { name: 'entry', kind: 'entry', transitions: [{ to: 'blend' }] },
      {
        name: 'blend',
        blend: {
          input: name,
          animations: vals.map((value, i) => ({
            value,
            animation: name === 'mouth' ? `mouth-${i}` : `${name}${value}`,
          })),
        },
      },
    ],
  });
const rig: Rig = {
  artboard: { name: 'Pet', width: 192, height: 208 },
  bones: [
    { name: 'bodyBone', x: 96, y: 154, length: 30 },
    { name: 'headBone', x: 96, y: 96, length: 40 },
    { name: 'tailBone', x: 128, y: 147, length: 40 },
    { name: 'eyeBone', parent: 'headBone', offset: true, x: 0, y: 4, length: 30 },
  ],
  images: images.reverse(),
  animations,
  stateMachine: { name: 'Pet', inputs, layers },
};
writeFileSync(new URL('rig.json', root), JSON.stringify(rig, null, 2) + '\n');
