/**
 * A zip that a Mac can open as an app: the links inside the app (symlinks) kept as links and every
 * file marked runnable, as a Unix zip has them. Windows' own zipping drops both, and a Mac app
 * zipped that way will not start.
 */

import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/** Zip `folder` — the folder itself as the zip's top level — into `zipPath`. */
export async function zipFolder(folder, zipPath) {
  const fd = openSync(zipPath, 'w');
  const central = [];
  let offset = 0;
  const write = (buf) => {
    writeSync(fd, buf);
    offset += buf.length;
  };

  const add = (abs, rel) => {
    const st = lstatSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) add(path.join(abs, name), `${rel}/${name}`);
      return;
    }
    const link = st.isSymbolicLink();
    const data = link ? Buffer.from(readlinkSync(abs).replaceAll('\\', '/')) : readFileSync(abs);
    const packed = link ? data : deflateRawSync(data, { level: 6 });
    const method = link ? 0 : 8;
    const crc = crc32(data);
    const name = Buffer.from(rel, 'utf8');
    // Unix mode in the top half of the external attributes: a link, or a file anyone may run.
    const mode = link ? 0o120755 : 0o100755;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names in UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10); // time and date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const at = offset;
    write(local);
    write(name);
    write(packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made on Unix
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(0, 30); // extra, comment, disk
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(at, 42);
    central.push(Buffer.concat([entry, name]));
  };

  add(folder, path.basename(folder));

  const start = offset;
  for (const c of central) write(c);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - start, 12);
  end.writeUInt32LE(start, 16);
  end.writeUInt16LE(0, 20);
  write(end);
  closeSync(fd);
}
