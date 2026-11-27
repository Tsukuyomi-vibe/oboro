import {readFile,mkdir,writeFile} from 'node:fs/promises';

// Recompute the package's contrast evidence from the shipped tokens. No local
// pre-existing artifact, browser observation or machine metadata is required.
const root=new URL('../',import.meta.url);
const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
const css=await readFile(new URL('src/ui/theme.css',root),'utf8');
const pairs=[
  ...['text','text-secondary','accent','accent-hover','accent-active','success','warning','danger'].flatMap(foreground=>['bg','surface','accent-subtle'].map(background=>[foreground,background,4.5])),
  ...['accent','accent-hover','accent-active'].map(background=>['on-accent',background,4.5]),
  ...['border-control','focus'].flatMap(foreground=>['bg','surface'].map(background=>[foreground,background,3]))
];
function luminance(hex){
  if(!/^#[0-9a-f]{6}$/i.test(hex??''))throw Error('Missing or unsupported semantic color token');
  const channels=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
}
const themes=['light','dark'].map(theme=>{
  const selector=theme==='light'?/:root\s*\{([^}]+)\}/:/:root\[data-theme="dark"\]\s*\{([^}]+)\}/;
  const block=css.match(selector)?.[1];if(!block)throw Error('Missing theme tokens');
  const tokens=Object.fromEntries([...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map(match=>[match[1],match[2]]));
  return {theme,pairs:pairs.map(([foreground,background,min])=>{
    const a=luminance(tokens[foreground]),b=luminance(tokens[background]);const raw=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    return {foreground,background,min,ratio:Number(raw.toFixed(3)),pass:raw>=min};
  })};
});
const report={version:pkg.version,method:'WCAG sRGB relative luminance; actual semantic token pairs used for text, button states, focus and required control borders',pass:themes.every(theme=>theme.pairs.every(pair=>pair.pass)),themes};
if(!report.pass)throw Error('Semantic color contrast check failed');
await mkdir(new URL('artifacts/',root),{recursive:true});
await writeFile(new URL('artifacts/oboro-'+pkg.version+'-contrast.json',root),JSON.stringify(report,null,2)+'\n');
console.log('Color contrast: '+themes.reduce((count,theme)=>count+theme.pairs.length,0)+' pairs passed.');
