import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
/** Generated in each test run: geometric squares, no character or downloaded art. */
export function generateMediaFixture(root: string): void {
  mkdirSync(join(root, 'clips'), { recursive: true }); mkdirSync(join(root, 'frames'));
  for (let i = 0; i < 48; i++) {
    const png = new PNG({ width: 256,height:256 });
    for (let y = 50; y < 200; y++) for(let x=60;x<196;x++) {
      const at=(y*256+x)*4; png.data[at]=60+Math.round(30*Math.sin(i/48*Math.PI*2));png.data[at+1]=130;png.data[at+2]=220;png.data[at+3]=x<65||x>190?100:255;
    }
    writeFileSync(join(root,'frames',`${String(i).padStart(4,'0')}.png`),PNG.sync.write(png));
  }
  const ffmpeg=process.env.POCKYMOE_FFMPEG || 'ffmpeg';
  execFileSync(ffmpeg,['-y','-v','error','-framerate','24','-i',join(root,'frames/%04d.png'),'-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','18','-auto-alt-ref','0',join(root,'clips/a.webm')],{timeout:30_000});
  writeFileSync(join(root,'clips/b.webm'),readFileSync(join(root,'clips/a.webm')));
  writeFileSync(join(root,'clips/reaction.webm'),readFileSync(join(root,'clips/a.webm')));
  const atlas=new PNG({width:1536,height:1872});for(let row=0;row<9;row++)for(let col=0;col<8;col++)for(let y=50;y<170;y++)for(let x=55;x<140;x++){const at=((row*208+y)*1536+col*192+x)*4;atlas.data[at]=90;atlas.data[at+1]=130;atlas.data[at+2]=220;atlas.data[at+3]=255;}
  writeFileSync(join(root,'spritesheet.png'),PNG.sync.write(atlas));
  // A plain geometric peek tests layer handoff without any character imagery.
  const peek = new PNG({ width: 256, height: 256 });
  for (let y = 20; y < 220; y++) for (let x = 90; x < 256; x++) { const i=(y*256+x)*4;peek.data[i]=220;peek.data[i+1]=130;peek.data[i+2]=60;peek.data[i+3]=255; }
  writeFileSync(join(root,'peek.png'),PNG.sync.write(peek));
  const talk = new PNG({ width: 256, height: 768 });
  for (let frame = 0; frame < 3; frame++) for (let y = 50; y < 200; y++) for (let x = 60; x < 196; x++) {
    const at = ((frame * 256 + y) * 256 + x) * 4;
    talk.data[at] = 60; talk.data[at + 1] = 130; talk.data[at + 2] = 220; talk.data[at + 3] = 255;
    if (x >= 105 && x < 145 && y >= 54 && y < 56 + frame * 5) { talk.data[at] = 20 + frame * 80; talk.data[at + 1] = 20; talk.data[at + 2] = 20; }
  }
  const talkPng = join(root, 'talk.png'); writeFileSync(talkPng, PNG.sync.write(talk));
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', talkPng, '-c:v', 'libwebp', '-lossless', '1', join(root, 'clips/talk.webp')], { timeout: 10_000 });
  writeFileSync(join(root,'pet.json'),JSON.stringify({id:'synthetic',displayName:'Synthetic',description:'Generated geometric test fixture',spritesheetPath:'spritesheet.png',remoteCodex:{peek:{path:'peek.png',width:256,height:256,anchor:[.7,.5],alertAnchor:.85,headHeight:1,bounds:[90/256,20/256,1,220/256]},faceBox:[.35,.1,.7,.27],talk:{path:'clips/talk.webp',frames:3},clipFormat:{mediaType:'webm-vp9-alpha',fps:24,width:256,height:256,columns:1},clips:{running:[{path:'clips/a.webm',frames:48}],idle:[{path:'clips/a.webm',frames:48},{path:'clips/b.webm',frames:48}],poked:[{path:'clips/reaction.webm',frames:48}]}}}));
}
