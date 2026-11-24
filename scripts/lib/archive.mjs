// ZIP (stored entries, UTF-8, fixed timestamp): deterministic and dependency-free.
const table=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0});
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
export function createStoredZip(entries){
  if(entries.length>65535)throw Error('ZIP64 is not supported');
  const names=new Set();const files=[];const directory=[];let offset=0;
  for(const entry of [...entries].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(typeof entry.name!=='string'||!entry.name.length||entry.name.startsWith('/')||entry.name.includes('\\')||entry.name.includes(':')||entry.name.includes('\0')||entry.name.split('/').some(part=>part==='..'||part==='.'||!part)||names.has(entry.name))throw Error('Unsafe or duplicate ZIP path');
    names.add(entry.name);const name=Buffer.from(entry.name,'utf8');const data=Buffer.from(entry.data);
    if(name.length>65535||data.length>0xffffffff||offset>0xffffffff)throw Error('ZIP64 is not supported');
    const crc=crc32(data);const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    files.push(header,name,data);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(33,14);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    directory.push(central,name);offset+=header.length+name.length+data.length;
  }
  const central=Buffer.concat(directory);if(offset+central.length>0xffffffff)throw Error('ZIP64 is not supported');
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,central,end]);
}
